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
            
            // Debug: Look for stats in body text
            const followerMatches = bodyText.match(/(\d+(?:,\d+)*[KMB]?)\s*(?:followers?|Followers?)/gi);
            const followingMatches = bodyText.match(/(\d+(?:,\d+)*[KMB]?)\s*(?:following|Following)/gi);
            const postsMatches = bodyText.match(/(\d+(?:,\d+)*[KMB]?)\s*(?:posts?|Posts?)/gi);
            
            log.info(`Found follower patterns: ${JSON.stringify(followerMatches)}`);
            log.info(`Found following patterns: ${JSON.stringify(followingMatches)}`);
            log.info(`Found posts patterns: ${JSON.stringify(postsMatches)}`);
            
            // Check for login redirect or blocks
            if (pageTitle.includes('Login') || body.includes('login_and_signup_page')) {
                throw new Error('Instagram redirected to login page - profile may be private or blocked');
            }
            
            if (body.includes('Page Not Found') || $('h2').text().includes("Sorry, this page isn't available")) {
                throw new Error('Profile not found or unavailable');
            }
            
            // Extract profile data using multiple strategies
            const profileData = extractProfileData($, url);
            
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
                /^([^(]+)/, // Just the name part
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
    
    // Extract full name
    if (!data.fullName && ogTitle) {
        // Remove username part to get full name
        data.fullName = ogTitle.replace(/\(@[^)]+\)/, '').trim();
    }
    
    // Extract profile image
    if (!data.profileImage && ogImage) {
        data.profileImage = ogImage;
    }
    
    // Strategy 3: Extract stats from meta description
    if (ogDescription) {
        // Try multiple patterns for meta description
        const patterns = [
            // Pattern 1: "X Followers, Y Following, Z Posts - Bio"
            /(\d+(?:,\d+)*[KMB]?)\s*Followers?,\s*(\d+(?:,\d+)*[KMB]?)\s*Following,\s*(\d+(?:,\d+)*[KMB]?)\s*Posts?\s*-\s*(.+)/i,
            // Pattern 2: "X followers, Y following, Z posts"
            /(\d+(?:,\d+)*[KMB]?)\s*followers?,\s*(\d+(?:,\d+)*[KMB]?)\s*following,\s*(\d+(?:,\d+)*[KMB]?)\s*posts?/i,
            // Pattern 3: Just look for the bio part
            /See Instagram photos and videos from (.+?)(?:\s*\((@[^)]+)\))?(.*)$/
        ];
        
        let statsExtracted = false;
        
        for (const pattern of patterns) {
            const match = ogDescription.match(pattern);
            if (match) {
                if (match.length >= 4 && match[1] && match[2] && match[3]) {
                    // Stats pattern matched
                    data.followers = data.followers || parseInstagramCount(match[1]);
                    data.following = data.following || parseInstagramCount(match[2]);
                    data.postsCount = data.postsCount || parseInstagramCount(match[3]);
                    
                    // Extract bio if available
                    if (match[4]) {
                        const bioText = match[4].trim();
                        if (bioText.startsWith('See Instagram photos and videos from')) {
                            const bioMatch = bioText.match(/See Instagram photos and videos from (.+?)(?:\s*\((@[^)]+)\))?(.*)$/);
                            if (bioMatch) {
                                data.fullName = data.fullName || bioMatch[1].trim();
                                if (bioMatch[2]) {
                                    data.username = data.username || bioMatch[2].replace('@', '');
                                }
                                data.bio = bioMatch[3] ? bioMatch[3].trim() : null;
                            }
                        } else {
                            data.bio = bioText;
                        }
                    }
                    statsExtracted = true;
                    break;
                }
            }
        }
        
        // If no stats found in meta description, try to extract name and bio
        if (!statsExtracted && ogDescription) {
            if (ogDescription.includes('See Instagram photos and videos from')) {
                const nameMatch = ogDescription.match(/See Instagram photos and videos from (.+?)(?:\s*\((@[^)]+)\))?(.*)$/);
                if (nameMatch) {
                    data.fullName = data.fullName || nameMatch[1].trim();
                    if (nameMatch[2]) {
                        data.username = data.username || nameMatch[2].replace('@', '');
                    }
                    data.bio = nameMatch[3] ? nameMatch[3].trim() : null;
                }
            } else {
                // Might be a custom bio
                data.bio = data.bio || ogDescription;
            }
        }
    }
    
    // Strategy 4: Extract stats from page body text (fallback)
    const bodyText = $('body').text();
    
    if (!data.followers) {
        const followerPatterns = [
            /(\d+(?:,\d+)*[KMB]?)\s*followers?/gi,
            /followers?\s*(\d+(?:,\d+)*[KMB]?)/gi
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
            /(\d+(?:,\d+)*[KMB]?)\s*following/gi,
            /following\s*(\d+(?:,\d+)*[KMB]?)/gi
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
            /(\d+(?:,\d+)*[KMB]?)\s*posts?/gi,
            /posts?\s*(\d+(?:,\d+)*[KMB]?)/gi
        ];
        
        for (const pattern of postsPatterns) {
            const matches = [...bodyText.matchAll(pattern)];
            if (matches.length > 0) {
                data.postsCount = parseInstagramCount(matches[0][1]);
                break;
            }
        }
    }
    
    // Strategy 5: Check for verification
    data.isVerified = bodyText.toLowerCase().includes('verified') || 
                     $('[title*="verified" i], [alt*="verified" i]').length > 0 ||
                     $('body').html().toLowerCase().includes('verified');
    
    // Strategy 6: Extract website links
    $('a[href]').each((i, link) => {
        const href = $(link).attr('href');
        if (href && 
            href.startsWith('http') && 
            !href.includes('instagram.com') && 
            !href.includes('facebook.com') &&
            !data.website) {
            data.website = href;
        }
    });
    
    return data;
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