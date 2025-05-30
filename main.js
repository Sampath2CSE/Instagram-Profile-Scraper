// main.js - Working Instagram Profile Scraper (HTTP-based like Apify's official version)
import { Actor } from 'apify';
import { CheerioCrawler, log } from 'crawlee';

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
            
            // Extract profile data using multiple strategies
            const profileData = extractProfileData($, url, body);
            
            // Post-process to ensure we get bio and website from ANY source
            profileData.bio = profileData.bio || extractBioFromAnywhere($, body);
            profileData.website = profileData.website || extractWebsiteFromAnywhere($, body);
            profileData.isVerified = profileData.isVerified || detectVerification($, body);
            
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
function extractProfileData($, url) {
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
    
    // Strategy 1: Extract from JSON-LD structured data
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
        data.username = jsonData.alternateName || jsonData.name;
        data.fullName = jsonData.name;
        data.bio = jsonData.description;
        data.profileImage = jsonData.image;
        data.website = jsonData.url !== url ? jsonData.url : null;
        
        // Extract stats from interactionStatistic if available
        if (jsonData.interactionStatistic) {
            jsonData.interactionStatistic.forEach(stat => {
                if (stat.interactionType === 'https://schema.org/FollowAction') {
                    data.followers = parseInt(stat.userInteractionCount) || null;
                }
            });
        }
    }
    
    // Strategy 2: Extract from meta tags
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const ogDescription = $('meta[property="og:description"]').attr('content');
    const ogImage = $('meta[property="og:image"]').attr('content');
    
    // Extract username from various sources
    if (!data.username) {
        if (ogTitle) {
            // Try different title formats
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
        
        // Fallback to URL
        if (!data.username) {
            const urlParts = url.split('/').filter(Boolean);
            data.username = urlParts[urlParts.length - 1];
        }
    }
    
    // Extract full name from title
    if (!data.fullName && ogTitle) {
        // Clean patterns to extract just the name
        let cleanName = ogTitle;
        
        // Remove "• Instagram photos and videos" part
        cleanName = cleanName.replace(/\s*•.*$/, '');
        // Remove (@username) part  
        cleanName = cleanName.replace(/\s*\(@[^)]+\)/, '');
        // Remove "Instagram photos and videos" part
        cleanName = cleanName.replace(/\s*Instagram photos and videos.*$/, '');
        
        data.fullName = cleanName.trim() || null;
    }
    
    // Extract profile image
    if (!data.profileImage && ogImage) {
        data.profileImage = ogImage;
    }
    
    // Strategy 3: Extract stats from meta description first, then body text
    if (ogDescription) {
        // Try multiple patterns for meta description
        const patterns = [
            // Pattern 1: "X Followers, Y Following, Z Posts - Bio"
            /(\d+(?:,\d+)*[KMB]?)\s*Followers?,\s*(\d+(?:,\d+)*[KMB]?)\s*Following,\s*(\d+(?:,\d+)*[KMB]?)\s*Posts?\s*-\s*(.+)/i,
            // Pattern 2: "X followers, Y following, Z posts"
            /(\d+(?:,\d+)*[KMB]?)\s*followers?,\s*(\d+(?:,\d+)*[KMB]?)\s*following,\s*(\d+(?:,\d+)*[KMB]?)\s*posts?/i,
        ];
        
        let statsExtracted = false;
        
        for (const pattern of patterns) {
            const match = ogDescription.match(pattern);
            if (match && match.length >= 4 && match[1] && match[2] && match[3]) {
                // Stats pattern matched
                data.followers = data.followers || parseInstagramCount(match[1]);
                data.following = data.following || parseInstagramCount(match[2]);
                data.postsCount = data.postsCount || parseInstagramCount(match[3]);
                statsExtracted = true;
                break;
            }
        }
    }
    
    // Strategy 4: Extract stats from page body text (fallback)
    const bodyText = $('body').text();
    
    if (!data.followers || !data.following || !data.postsCount) {
        // More aggressive regex patterns for stats
        if (!data.followers) {
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
        
        if (!data.following) {
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
        
        if (!data.postsCount) {
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
    
    return data;
}

// Aggressive bio extraction from ALL possible sources
function extractBioFromAnywhere($, bodyHtml) {
    log.info('🔍 Aggressive bio extraction starting...');
    
    // Method 1: Look for Instagram's internal JSON data (what official scraper uses)
    let foundBio = null;
    
    $('script').each((i, script) => {
        if (foundBio) return false;
        
        const content = $(script).html();
        if (content && content.includes('"biography"')) {
            try {
                // Look for the main user profile data (where the real bio lives)
                const mainUserPatterns = [
                    // Pattern 1: Look for the main profile data structure
                    /"profilePage_\d+":\s*{[^{}]*"user":\s*{[^{}]*"biography":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
                    // Pattern 2: Direct user object with biography
                    /"user":\s*{[^{}]*"biography":\s*"([^"\\]*(?:\\.[^"\\]*)*)"[^{}]*"username":\s*"[^"]+"/,
                    // Pattern 3: Profile data with biography
                    /"biography":\s*"([^"\\]*(?:\\.[^"\\]*)*)"[^{}]*"followers_count"/,
                    // Pattern 4: User node with biography
                    /"node":\s*{[^{}]*"biography":\s*"([^"\\]*(?:\\.[^"\\]*)*)"[^{}]*"follower_count"/
                ];
                
                for (const pattern of mainUserPatterns) {
                    const match = content.match(pattern);
                    if (match && match[1]) {
                        let bioText = match[1];
                        
                        // Properly decode JSON string
                        try {
                            bioText = JSON.parse(`"${bioText}"`);
                        } catch (e) {
                            // Manual decode
                            bioText = bioText
                                .replace(/\\"/g, '"')
                                .replace(/\\n/g, ' ')
                                .replace(/\\r/g, '')
                                .replace(/\\t/g, ' ')
                                .replace(/\\\\/g, '\\')
                                .replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
                                    return String.fromCharCode(parseInt(hex, 16));
                                });
                        }
                        
                        bioText = bioText.trim();
                        
                        // Filter out metadata and technical strings
                        if (bioText.length > 3 && 
                            bioText.length < 1000 && 
                            !bioText.includes('profilePage') &&
                            !bioText.includes('meta') &&
                            !bioText.includes('"title"') &&
                            !bioText.includes('canonicalRouteName') &&
                            !bioText.toLowerCase().includes('instagram photos and videos')) {
                            
                            log.info(`📝 Found real biography in script: ${bioText}`);
                            foundBio = bioText;
                            return false;
                        }
                    }
                }
                
                // If no main patterns found, try to find the GraphQL data
                if (!foundBio && content.includes('graphql')) {
                    const graphqlPattern = /"data":\s*{[^{}]*"user":\s*{[^{}]*"biography":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/;
                    const graphqlMatch = content.match(graphqlPattern);
                    if (graphqlMatch && graphqlMatch[1]) {
                        let bioText = graphqlMatch[1];
                        try {
                            bioText = JSON.parse(`"${bioText}"`);
                        } catch (e) {
                            bioText = bioText.replace(/\\"/g, '"').replace(/\\n/g, ' ');
                        }
                        
                        if (bioText.length > 3 && !bioText.includes('profilePage')) {
                            log.info(`📝 Found GraphQL biography: ${bioText}`);
                            foundBio = bioText;
                            return false;
                        }
                    }
                }
                
            } catch (e) {
                log.info(`Error parsing bio from script: ${e.message}`);
            }
        }
    });
    
    if (foundBio) return foundBio;
    
    // Method 2: Look for bio in the visible page text (fallback)
    const bodyText = $('body').text();
    log.info(`🔍 Searching body text for bio keywords...`);
    
    // Look for common bio phrases that appear near profile info
    const bioPatterns = [
        // Look for text after common bio indicators
        /(?:Get My|Building|Creating|Helping|Teaching|Sharing)[^.!?]*[.!?]/gi,
        /(?:Templates|Automation|Expert|Coach|Founder)[^.!?]*[.!?]/gi,
        /(?:Free|Download|Link|Check out)[^.!?]*[.!?]/gi
    ];
    
    for (const pattern of bioPatterns) {
        const matches = [...bodyText.matchAll(pattern)];
        for (const match of matches) {
            let bioCandidate = match[0].trim();
            
            // Clean and validate
            if (bioCandidate.length > 10 && 
                bioCandidate.length < 300 && 
                !bioCandidate.includes('posts') &&
                !bioCandidate.includes('followers') &&
                !bioCandidate.includes('following')) {
                
                log.info(`📝 Found potential bio in body text: ${bioCandidate}`);
                return bioCandidate;
            }
        }
    }
    
    log.info('❌ No bio found with aggressive extraction');
    return null;
}

// Aggressive website extraction from ALL possible sources  
function extractWebsiteFromAnywhere($, bodyHtml) {
    log.info('🔗 Aggressive website extraction starting...');
    
    // Method 1: Look for Instagram's internal JSON data
    let foundWebsite = null;
    
    $('script').each((i, script) => {
        if (foundWebsite) return false;
        
        const content = $(script).html();
        if (content && content.includes('"external_url"')) {
            try {
                // Look for main profile external URL patterns
                const urlPatterns = [
                    // Pattern 1: Profile page external URL
                    /"profilePage_\d+":\s*{[^{}]*"user":\s*{[^{}]*"external_url":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/,
                    // Pattern 2: Direct user external URL
                    /"user":\s*{[^{}]*"external_url":\s*"([^"\\]*(?:\\.[^"\\]*)*)"[^{}]*"username"/,
                    // Pattern 3: External URL with follower count (profile context)
                    /"external_url":\s*"([^"\\]*(?:\\.[^"\\]*)*)"[^{}]*"followers_count"/,
                    // Pattern 4: GraphQL data external URL
                    /"data":\s*{[^{}]*"user":\s*{[^{}]*"external_url":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/
                ];
                
                for (const pattern of urlPatterns) {
                    const match = content.match(pattern);
                    if (match && match[1]) {
                        let url = match[1];
                        
                        // Properly decode JSON string
                        try {
                            url = JSON.parse(`"${url}"`);
                        } catch (e) {
                            url = url.replace(/\\"/g, '"').replace(/\\\//g, '/');
                        }
                        
                        if (url && url.includes('http') && !url.includes('instagram.com')) {
                            log.info(`🔗 Found external_url in script: ${url}`);
                            foundWebsite = url;
                            return false;
                        }
                    }
                }
                
                // Also look for bio link services directly
                const bioLinkServices = ['linktr.ee', 'bio.link', 'linkin.bio', 'beacons.ai'];
                for (const service of bioLinkServices) {
                    if (content.includes(service)) {
                        const servicePattern = new RegExp(`"[^"]*${service}\\/[^"]+"`);
                        const serviceMatch = content.match(servicePattern);
                        if (serviceMatch) {
                            let link = serviceMatch[0].replace(/"/g, '');
                            if (!link.startsWith('http')) {
                                link = `https://${link}`;
                            }
                            log.info(`🔗 Found ${service} link: ${link}`);
                            foundWebsite = link;
                            return false;
                        }
                    }
                }
                
            } catch (e) {
                log.info(`Error parsing website from script: ${e.message}`);
            }
        }
    });
    
    if (foundWebsite) return foundWebsite;
    
    log.info('❌ No website found with aggressive extraction');
    return null;
}

// Aggressive verification detection
function detectVerification($, bodyHtml) {
    log.info('✅ Checking verification status...');
    
    // Method 1: Look for Instagram's internal JSON data (official scraper approach)
    let isVerified = false;
    
    $('script').each((i, script) => {
        if (isVerified) return false;
        
        const content = $(script).html();
        if (content) {
            try {
                // Pattern 1: Look for "is_verified" or "verified" boolean fields
                const verifiedMatch = content.match(/"(?:is_verified|verified)":\s*(true|false)/);
                if (verifiedMatch) {
                    isVerified = verifiedMatch[1] === 'true';
                    if (isVerified) {
                        log.info('✅ Found verification status in JSON: true');
                        return false;
                    }
                }
                
                // Pattern 2: Look for user data with verification
                if (content.includes('"user"') && content.includes('verified')) {
                    const userVerifiedMatch = content.match(/"user":\s*{[^}]*"(?:is_verified|verified)":\s*(true|false)/);
                    if (userVerifiedMatch) {
                        isVerified = userVerifiedMatch[1] === 'true';
                        if (isVerified) {
                            log.info('✅ Found user verification in JSON: true');
                            return false;
                        }
                    }
                }
            } catch (e) {
                // Continue if parsing fails
            }
        }
    });
    
    if (isVerified) return true;
    
    // Method 2: Look for text indicators
    const bodyText = $('body').text().toLowerCase();
    const fullHtml = (bodyHtml || $('body').html()).toLowerCase();
    
    const verificationIndicators = [
        'verified',
        'blue checkmark',
        'blue check',
        'verified account',
        'verification badge'
    ];
    
    for (const indicator of verificationIndicators) {
        if (bodyText.includes(indicator) || fullHtml.includes(indicator)) {
            log.info(`✅ Found verification indicator: ${indicator}`);
            return true;
        }
    }
    
    // Method 3: Check for SVG or icon elements
    const verificationSelectors = [
        'svg[aria-label*="verified" i]',
        '[title*="verified" i]',
        '[alt*="verified" i]',
        '.verified',
        '[data-verified]'
    ];
    
    for (const selector of verificationSelectors) {
        if ($(selector).length > 0) {
            log.info(`✅ Found verification via selector: ${selector}`);
            return true;
        }
    }
    
    log.info('❌ No verification indicators found');
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
log.info(`⚙️  Using same approach as Apify's official Instagram scraper`);

// Run the crawler
await crawler.run(requests);

log.info('✅ Instagram scraping completed!');
await Actor.exit();