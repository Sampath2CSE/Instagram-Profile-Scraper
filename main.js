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
            log.info(`Page title: ${pageTitle}`);
            
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

// Extract profile data from Instagram HTML (improved parsing)
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
    
    // Extract from JSON-LD data (Instagram's structured data)
    const scripts = $('script[type="application/ld+json"]');
    let jsonData = null;
    
    scripts.each((i, script) => {
        try {
            const content = $(script).html();
            if (content && content.includes('"@type":"Person"')) {
                jsonData = JSON.parse(content);
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
    
    // Fallback extraction from meta tags
    if (!data.username) {
        const ogTitle = $('meta[property="og:title"]').attr('content');
        if (ogTitle) {
            // Extract username from "Username (@username)" format
            const usernameMatch = ogTitle.match(/\(@([^)]+)\)/);
            if (usernameMatch) {
                data.username = usernameMatch[1];
            } else {
                data.username = ogTitle.split('(')[0]?.trim();
            }
        }
    }
    
    if (!data.username) {
        // Extract from URL as last resort
        const urlParts = url.split('/').filter(Boolean);
        data.username = urlParts[urlParts.length - 1];
    }
    
    // Extract bio from meta description
    if (!data.bio) {
        const metaDesc = $('meta[property="og:description"]').attr('content') || 
                        $('meta[name="description"]').attr('content');
        if (metaDesc) {
            data.bio = metaDesc;
            
            // Parse stats from meta description format: "X Followers, Y Following, Z Posts - Bio text"
            const statsMatch = metaDesc.match(/(\d+(?:,\d+)*)\s*Followers?,\s*(\d+(?:,\d+)*)\s*Following,\s*(\d+(?:,\d+)*)\s*Posts?\s*-\s*(.+)/i);
            if (statsMatch) {
                data.followers = parseInstagramCount(statsMatch[1]);
                data.following = parseInstagramCount(statsMatch[2]);
                data.postsCount = parseInstagramCount(statsMatch[3]);
                data.bio = statsMatch[4].trim();
                
                // Extract username and full name from bio if needed
                if (!data.fullName && statsMatch[4]) {
                    const bioText = statsMatch[4];
                    const fromMatch = bioText.match(/from (.+?) \(/);
                    if (fromMatch) {
                        data.fullName = fromMatch[1].trim();
                    }
                }
            }
        }
    }
    
    if (!data.profileImage) {
        data.profileImage = $('meta[property="og:image"]').attr('content');
    }
    
    // If stats weren't found in meta description, try parsing from page text
    if (!data.followers || !data.following || !data.postsCount) {
        const pageText = $('body').text();
        
        // More aggressive regex patterns for stats
        if (!data.followers) {
            const followerPatterns = [
                /(\d+(?:[,\.]\d+)*[KMB]?)\s*(?:followers?|Followers?)/gi,
                /followers?[:\s]*(\d+(?:[,\.]\d+)*[KMB]?)/gi
            ];
            
            for (const pattern of followerPatterns) {
                const match = pageText.match(pattern);
                if (match && match[1]) {
                    data.followers = parseInstagramCount(match[1]);
                    break;
                }
            }
        }
        
        if (!data.following) {
            const followingPatterns = [
                /(\d+(?:[,\.]\d+)*[KMB]?)\s*(?:following|Following)/gi,
                /following[:\s]*(\d+(?:[,\.]\d+)*[KMB]?)/gi
            ];
            
            for (const pattern of followingPatterns) {
                const match = pageText.match(pattern);
                if (match && match[1]) {
                    data.following = parseInstagramCount(match[1]);
                    break;
                }
            }
        }
        
        if (!data.postsCount) {
            const postsPatterns = [
                /(\d+(?:[,\.]\d+)*[KMB]?)\s*(?:posts?|Posts?)/gi,
                /posts?[:\s]*(\d+(?:[,\.]\d+)*[KMB]?)/gi
            ];
            
            for (const pattern of postsPatterns) {
                const match = pageText.match(pattern);
                if (match && match[1]) {
                    data.postsCount = parseInstagramCount(match[1]);
                    break;
                }
            }
        }
    }
    
    // Check for verification
    data.isVerified = $('body').text().includes('Verified') || 
                     $('[title*="verified" i], [alt*="verified" i]').length > 0 ||
                     $('body').html().includes('verified');
    
    // Extract website from links (exclude Instagram internal links)
    $('a[href]').each((i, link) => {
        const href = $(link).attr('href');
        if (href && 
            href.startsWith('http') && 
            !href.includes('instagram.com') && 
            !href.includes('facebook.com') &&
            !href.includes('facebookcorewwwi.onion') &&
            !data.website) {
            data.website = href;
        }
    });
    
    // Clean up the data
    if (data.bio && data.bio.startsWith('See Instagram photos and videos from')) {
        const bioMatch = data.bio.match(/See Instagram photos and videos from (.+?) \((@[^)]+)\)/);
        if (bioMatch) {
            data.fullName = bioMatch[1].trim();
            data.username = bioMatch[2].replace('@', '');
            data.bio = null; // This isn't a real bio
        }
    }
    
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