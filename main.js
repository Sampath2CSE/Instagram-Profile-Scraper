// main.js - Working Instagram Profile Scraper (HTTP-based like Apify's official version)
import { Actor } from 'apify';
import { CheerioCrawler, log } from 'crawlee';

// Helper function to parse window._sharedData JSON
function parseInstagramSharedData(htmlContent) {
    let sharedData = null;
    // Regex to find the window._sharedData object in a script tag
    const regex = /<script[^>]*>window\._sharedData\s*=\s*({[^;]+});<\/script>/;
    const match = htmlContent.match(regex);

    if (match && match[1]) {
        try {
            sharedData = JSON.parse(match[1]);
        } catch (e) {
            log.warning(`Failed to parse window._sharedData JSON: ${e.message}`);
        }
    } else {
        log.warning('window._sharedData script tag not found or regex failed.');
    }
    return sharedData;
}

// Initialize the Actor
await Actor.init();

// Get input from the Actor's input schema
const input = await Actor.getInput();
const {
    profileUrls = [],
    proxy = { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    maxRetries = 3,
    includeRecentPosts = false,
    maxPostsToScrape = 12
} = input;

// Validate input
if (!profileUrls || profileUrls.length === 0) {
    throw new Error('No profile URLs provided. Please add at least one Instagram profile URL.');
}

// Set up proxy configuration
const proxyConfiguration = await Actor.createProxyConfiguration(proxy);

// Real browser headers that work with Instagram
const getRandomHeaders = () => {
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    ];
    
    return {
        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'max-age=0',
        'Sec-Ch-Ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Connection': 'keep-alive',
        'DNT': '1'
    };
};

// Initialize HTTP-based crawler (like Apify's official scraper)
const crawler = new CheerioCrawler({
    proxyConfiguration,
    maxRequestRetries: maxRetries,
    maxConcurrency: 2, // Higher concurrency works with HTTP
    requestHandlerTimeoutSecs: 60,
    
    // Add delay between requests
    maxRequestsPerMinute: 20, // Conservative rate limiting
    
    // Custom headers for each request
    preNavigationHooks: [
        async ({ request }) => {
            // Add realistic headers to avoid detection
            request.headers = {
                ...request.headers,
                ...getRandomHeaders()
            };
            
            // Add random delay
            const delay = Math.random() * 3000 + 2000; // 2-5 seconds
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    ],
    
    async requestHandler({ request, $, body }) {
        const url = request.url;
        log.info(`Processing Instagram profile: ${url}`);
        
        try {
            // Check if we got the actual Instagram page content
            const pageTitle = $('title').text();
            const metaDesc = $('meta[property="og:description"]').attr('content');
            const bodyText = $('body').text();
            
            log.info(`Page title: ${pageTitle}`);
            log.info(`Meta description: ${metaDesc}`);
            log.info(`Body text length: ${bodyText.length}`);
            
            // Check for login redirect or blocks
            if (pageTitle.includes('Login') || body.includes('login_and_signup_page')) {
                throw new Error('Instagram redirected to login page - profile may be private or blocked');
            }
            
            if (body.includes('Page Not Found') || $('h2').text().includes("Sorry, this page isn't available")) {
                throw new Error('Profile not found or unavailable');
            }
            
            // Extract profile data using multiple strategies, prioritizing sharedData
            const profileData = extractProfileData($, url, body);
            
            // Apply ultimate fallbacks if data is still missing
            if (profileData.bio === null) {
                profileData.bio = extractBioFromAnywhere($, body);
            }
            if (profileData.website === null) {
                profileData.website = extractWebsiteFromAnywhere($, body);
            }
            if (profileData.isVerified === false) {
                profileData.isVerified = detectVerification($, body);
            }
            
            // Extract recent posts if requested
            if (includeRecentPosts) {
                profileData.recentPosts = extractRecentPosts($, maxPostsToScrape);
            }
            
            // Add metadata
            profileData.scrapedAt = new Date().toISOString();
            profileData.profileUrl = url;
            
            log.info(`✅ Successfully extracted data for: ${profileData.username || 'Unknown'}`);
            log.info(`📊 Stats: ${profileData.followers || 'N/A'} followers, ${profileData.following || 'N/A'} following`);
            
            // Save to dataset
            await Actor.pushData(profileData);
            
        } catch (error) {
            log.error(`❌ Failed to process ${url}: ${error.message}`);
            
            await Actor.pushData({
                url,
                error: error.message,
                timestamp: new Date().toISOString(),
                status: 'failed'
            });
        }
    },
    
    failedRequestHandler({ request, error }) {
        log.error(`💥 Request failed completely: ${request.url} - ${error.message}`);
    }
});

// Extract profile data from Instagram HTML (robust extraction for all profile types)
function extractProfileData($, url, bodyHtml) {
    const data = {
        username: null,
        fullName: null,
        bio: null,
        profileImage: null,
        followers: null,
        following: null,
        postsCount: null,
        website: null,
        isVerified: false
    };
    
    // --- STRATEGY 0: Extract from window._sharedData JSON (Most Reliable) ---
    const sharedData = parseInstagramSharedData(bodyHtml);
    if (sharedData && sharedData.entry_data && sharedData.entry_data.ProfilePage) {
        const profilePage = sharedData.entry_data.ProfilePage[0];
        if (profilePage && profilePage.graphql && profilePage.graphql.user) {
            const user = profilePage.graphql.user;

            data.username = user.username || data.username;
            data.fullName = user.full_name || data.fullName;
            data.bio = user.biography || data.bio;
            data.profileImage = user.profile_pic_url_hd || user.profile_pic_url || data.profileImage;
            data.isVerified = user.is_verified || data.isVerified;
            data.website = user.external_url || data.website;

            // Stats
            if (user.edge_followed_by && user.edge_followed_by.count !== undefined) {
                data.followers = user.edge_followed_by.count;
            }
            if (user.edge_follow && user.edge_follow.count !== undefined) {
                data.following = user.edge_follow.count;
            }
            if (user.edge_owner_to_timeline_media && user.edge_owner_to_timeline_media.count !== undefined) {
                data.postsCount = user.edge_owner_to_timeline_media.count;
            }
            log.info('✨ Successfully extracted initial data from window._sharedData.');
        }
    }
    
    // Strategy 1: Extract from JSON-LD structured data (Fallback)
    const scripts = $('script[type="application/ld+json"]');
    let jsonData = null;
    
    scripts.each((i, script) => {
        try {
            const content = $(script).html();
            if (content && content.includes('"@type":"Person"')) {
                jsonData = JSON.parse(content);
                return false; // Break the loop
            }
        } catch (e) {
            // Continue if JSON parsing fails
        }
    });
    
    if (jsonData) {
        data.username = data.username || jsonData.alternateName || jsonData.name;
        data.fullName = data.fullName || jsonData.name;
        data.bio = data.bio || jsonData.description;
        data.profileImage = data.profileImage || jsonData.image;
        data.website = data.website || (jsonData.url !== url ? jsonData.url : null);
        
        if (jsonData.interactionStatistic) {
            jsonData.interactionStatistic.forEach(stat => {
                if (stat.interactionType === 'https://schema.org/FollowAction') {
                    data.followers = data.followers || parseInt(stat.userInteractionCount) || null;
                }
            });
        }
    }
    
    // Strategy 2: Extract from meta tags (Fallback)
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const ogDescription = $('meta[property="og:description"]').attr('content');
    const ogImage = $('meta[property="og:image"]').attr('content');
    
    if (!data.username && ogTitle) {
        const usernamePatterns = [
            /\(@([^)]+)\)/, // "Name (@username)"
            /^([^(•]+)/, // Just the name part before (•
        ];
        
        for (const pattern of usernamePatterns) {
            const match = ogTitle.match(pattern);
            if (match) {
                data.username = match[1].trim().replace('@', '');
                break;
            }
        }
    }
    
    if (!data.username) {
        const urlParts = url.split('/').filter(Boolean);
        data.username = urlParts[urlParts.length - 1];
    }
    
    if (!data.fullName && ogTitle) {
        let cleanName = ogTitle;
        cleanName = cleanName.replace(/\s*•.*$/, '');
        cleanName = cleanName.replace(/\s*\(@[^)]+\)/, '');
        cleanName = cleanName.replace(/\s*Instagram photos and videos.*$/, '');
        data.fullName = cleanName.trim() || null;
    }
    
    if (!data.profileImage && ogImage) {
        data.profileImage = ogImage;
    }
    
    // Strategy 3: Extract stats from meta description (Fallback)
    if (ogDescription) {
        const patterns = [
            /(\d+(?:,\d+)*[KMB]?)\s*Followers?,\s*(\d+(?:,\d+)*[KMB]?)\s*Following,\s*(\d+(?:,\d+)*[KMB]?)\s*Posts?\s*-\s*(.+)/i,
            /(\d+(?:,\d+)*[KMB]?)\s*followers?,\s*(\d+(?:,\d+)*[KMB]?)\s*following,\s*(\d+(?:,\d+)*[KMB]?)\s*posts?/i,
        ];
        
        for (const pattern of patterns) {
            const match = ogDescription.match(pattern);
            if (match && match.length >= 4 && match[1] && match[2] && match[3]) {
                data.followers = data.followers || parseInstagramCount(match[1]);
                data.following = data.following || parseInstagramCount(match[2]);
                data.postsCount = data.postsCount || parseInstagramCount(match[3]);
                break;
            }
        }
    }
    
    // Strategy 4: Extract stats from page body text (Lowest Priority Fallback)
    const bodyText = $('body').text();
    if (data.followers === null || data.following === null || data.postsCount === null) {
        if (data.followers === null) {
            const followerPatterns = [
                /(\d+(?:[,\.]\d+)*[KMB]?)\s*followers?/gi,
                /followers?\s*(\d+(?:[,\.]\d+)*[KMB]?)/gi
            ];
            
            for (const pattern of followerPatterns) {
                const matches = [...bodyText.matchAll(pattern)];
                if (matches.length > 0) {
                    data.followers = parseInstagramCount(matches[0][1]);
                    break;
                }
            }
        }
        
        if (data.following === null) {
            const followingPatterns = [
                /(\d+(?:[,\.]\d+)*[KMB]?)\s*following/gi,
                /following\s*(\d+(?:[,\.]\d+)*[KMB]?)/gi
            ];
            
            for (const pattern of followingPatterns) {
                const matches = [...bodyText.matchAll(pattern)];
                if (matches.length > 0) {
                    data.following = parseInstagramCount(matches[0][1]);
                    break;
                }
            }
        }
        
        if (data.postsCount === null) {
            const postsPatterns = [
                /(\d+(?:[,\.]\d+)*[KMB]?)\s*posts?/gi,
                /posts?\s*(\d+(?:[,\.]\d+)*[KMB]?)/gi
            ];
            
            for (const pattern of postsPatterns) {
                const matches = [...bodyText.matchAll(pattern)];
                if (matches.length > 0) {
                    data.postsCount = parseInstagramCount(matches[0][1]);
                    break;
                }
            }
        }
    }
    
    // Ensure `null` for non-extracted values if they are 0 by parsing
    data.followers = data.followers === 0 ? null : data.followers;
    data.following = data.following === 0 ? null : data.following;
    data.postsCount = data.postsCount === 0 ? null : data.postsCount;

    return data;
}

// Aggressive bio extraction from ALL possible sources (Fallback)
function extractBioFromAnywhere($, bodyHtml) {
    log.info('🔍 Aggressive bio extraction (fallback) starting...');
    
    let foundBio = null;
    
    // Method 1: Look in ALL script tags for JSON data (less specific than sharedData)
    $('script').each((i, script) => {
        if (foundBio) return false;
        const content = $(script).html();
        if (content) {
            const bioMatches = content.match(/"biography":\s*"(.*?)(?<!\\)"/g); // More robust regex for escaped quotes
            if (bioMatches) {
                for (const match of bioMatches) {
                    const bioTextMatch = match.match(/"biography":\s*"(.*?)(?<!\\)"/);
                    if (bioTextMatch && bioTextMatch[1]) {
                        let bioText = bioTextMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'); // Handle newlines and escaped quotes
                        if (bioText && bioText.length > 3) {
                            log.info(`📝 Found bio in script (fallback): ${bioText}`);
                            foundBio = bioText;
                            return false;
                        }
                    }
                }
            }
        }
    });
    
    if (foundBio) return foundBio;
    
    // Method 2: Look in raw HTML for common bio patterns (least reliable)
    const bioKeywords = ['Digital creator', 'Creator', 'Entrepreneur', 'Founder', 'CEO', 'Coach', 'Artist', 'Automation', 'Expert'];
    const bodyText = $('body').text();
    
    for (const keyword of bioKeywords) {
        if (bodyText.includes(keyword)) {
            log.info(`🎯 Found keyword "${keyword}" in body (fallback)`);
            const regex = new RegExp(`(?<=\\s|^)${keyword}[^.!?]{5,200}[.!?]?`, 'i'); // Improved regex to capture a sentence/phrase
            const match = bodyText.match(regex);
            if (match && match[0]) {
                let bio = match[0].trim();
                bio = bio.replace(/\s+/g, ' ');
                if (bio.length > 10 && bio.length < 500) {
                    log.info(`📝 Extracted bio around keyword (fallback): ${bio}`);
                    return bio;
                }
            }
        }
    }
    
    log.info('❌ No bio found with aggressive extraction (fallback)');
    return null;
}

// Aggressive website extraction from ALL possible sources (Fallback)
function extractWebsiteFromAnywhere($, bodyHtml) {
    log.info('🔗 Aggressive website extraction (fallback) starting...');
    
    let foundWebsite = null;
    
    // Method 1: Look in ALL script tags for external URLs
    $('script').each((i, script) => {
        if (foundWebsite) return false;
        
        const content = $(script).html();
        if (content) {
            // Look for external_url in JSON
            const urlMatches = content.match(/"external_url":\s*"([^"]+)"/g);
            if (urlMatches) {
                for (const match of urlMatches) {
                    const url = match.match(/"external_url":\s*"([^"]+)"/)[1];
                    if (url && !url.includes('instagram.com')) {
                        log.info(`🔗 Found external_url in script (fallback): ${url}`);
                        foundWebsite = url;
                        return false;
                    }
                }
            }
            
            // Look for any linktr.ee or common bio links
            const bioLinkMatches = content.match(/(https?:\/\/(?:www\.)?(?:linktr\.ee|bio\.link|linkin\.bio|beacons\.ai|bit\.ly|tinyurl\.com)\/[^"'\s]+)/gi);
            if (bioLinkMatches) {
                const link = bioLinkMatches[0];
                log.info(`🔗 Found bio link in script (fallback): ${link}`);
                foundWebsite = link;
                return false;
            }
        }
    });
    
    if (foundWebsite) return foundWebsite;
    
    // Method 2: Look in raw HTML for URL patterns
    const urlPatterns = [
        /(https?:\/\/(?:www\.)?(?:linktr\.ee|bio\.link|linkin\.bio|beacons\.ai|bit\.ly|tinyurl\.com)\/[\w\.-]+)/gi,
        /(https?:\/\/(?:www\.)?[\w\.-]+\.[\w]{2,4}\/[^\s"']+)/gi // More general URL pattern
    ];
    
    const fullHtml = bodyHtml || $('body').html();
    
    for (const pattern of urlPatterns) {
        const matches = [...fullHtml.matchAll(pattern)];
        if (matches.length > 0) {
            const foundUrl = matches[0][1];
            // Filter out Instagram's own URLs or common social media links if not the primary external URL
            if (!foundUrl.includes('instagram.com') && !foundUrl.includes('facebook.com') && !foundUrl.includes('twitter.com')) {
                log.info(`🔗 Found URL via pattern (fallback): ${foundUrl}`);
                return foundUrl;
            }
        }
    }
    
    log.info('❌ No website found with aggressive extraction (fallback)');
    return null;
}

// Aggressive verification detection (Fallback)
function detectVerification($, bodyHtml) {
    log.info('✅ Checking verification status (fallback)...');
    
    const fullHtml = (bodyHtml || $('body').html()).toLowerCase();
    
    // Check for specific SVG or icon elements that Instagram uses for verification
    const verificationSelectors = [
        'svg[aria-label*="verified" i]',
        'img[src*="verified_badge" i]',
        'span[aria-label*="verified" i]',
        'span[title*="verified" i]',
        'div[role="img"][aria-label*="verified" i]', // New selector for potential image roles
        '._ab6l', // Common Instagram class for the badge, but can change
        '[data-testid="verified_badge"]' // Sometimes elements have data-testid attributes
    ];
    
    for (const selector of verificationSelectors) {
        if ($(selector).length > 0) {
            log.info(`✅ Found verification via selector (fallback): ${selector}`);
            return true;
        }
    }
    
    // Less reliable: Check for "verified" text in a more controlled context
    // Avoid general body text search as it can lead to false positives (e.g., "we verified your account")
    if ($('h1').text().toLowerCase().includes('verified') || $('h2').text().toLowerCase().includes('verified')) {
        log.info('✅ Found "verified" in a heading (fallback)');
        return true;
    }
    
    log.info('❌ No verification indicators found (fallback)');
    return false;
}

// Extract recent posts from the HTML
function extractRecentPosts($, maxPosts) {
    const posts = [];
    
    // Look for post links
    $('a[href*="/p/"], a[href*="/reel/"]').each((i, link) => {
        if (posts.length >= maxPosts) return false;
        
        const href = $(link).attr('href');
        const img = $(link).find('img').first();
        
        if (href && img.length) {
            posts.push({
                url: href.startsWith('http') ? href : `https://www.instagram.com${href}`,
                imageUrl: img.attr('src'),
                altText: img.attr('alt') || ''
            });
        }
    });
    
    return posts;
}

// Parse Instagram count format (K, M, B)
function parseInstagramCount(countStr) {
    if (!countStr) return null;
    
    const cleanStr = countStr.toString().replace(/[,\s]/g, '').toLowerCase();
    const match = cleanStr.match(/^([\d.]+)([kmb]?)$/);
    
    if (!match) return parseInt(cleanStr) || null;
    
    const [, numberStr, multiplier] = match;
    const number = parseFloat(numberStr);
    
    switch (multiplier) {
        case 'k': return Math.round(number * 1000);
        case 'm': return Math.round(number * 1000000);
        case 'b': return Math.round(number * 1000000000);
        default: return Math.round(number);
    }
}

// Prepare URLs for crawling
const requests = profileUrls.map(urlInput => {
    let url;
    if (typeof urlInput === 'string') {
        url = urlInput;
    } else if (urlInput.url) {
        url = urlInput.url;
    } else {
        throw new Error('Invalid URL format');
    }
    
    // Validate and normalize Instagram URL
    if (!url.includes('instagram.com/')) {
        throw new Error(`Not an Instagram URL: ${url}`);
    }
    
    // Ensure proper format
    url = url.replace(/\/$/, '');
    if (!url.startsWith('http')) {
        url = 'https://' + url;
    }
    
    return { url };
});

log.info(`🚀 Starting HTTP-based Instagram scraper for ${requests.length} profile(s)`);
log.info(`⚙️  Using same approach as Apify's official Instagram scraper`);

// Run the crawler
await crawler.run(requests);

log.info('✅ Instagram scraping completed!');
await Actor.exit();