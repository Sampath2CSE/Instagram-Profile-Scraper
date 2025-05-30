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
            
            // Extract profile data using the enhanced extraction
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
            if (profileData.bio) {
                log.info(`📝 Bio: ${profileData.bio.substring(0, 100)}...`);
            }
            if (profileData.website) {
                log.info(`🔗 Website: ${profileData.website}`);
            }
            
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

// Extract profile data from Instagram HTML (targeting exact API data like official scraper)
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
        isVerified: false,
        isBusinessAccount: false
    };
    
    // Strategy 1: Extract from Instagram's internal API data (same as official scraper)
    $('script').each((i, script) => {
        const content = $(script).html();
        if (content && content.length > 1000) { // Only check substantial scripts
            try {
                // Look for the main profile data in Instagram's internal API responses
                // This is the same data the official scraper uses
                
                // Pattern 1: GraphQL user data
                const graphqlUserPattern = /"graphql":\s*{[^}]*"user":\s*({[^{}]*"biography"[^{}]*})/;
                const graphqlMatch = content.match(graphqlUserPattern);
                if (graphqlMatch) {
                    try {
                        const userObj = JSON.parse(graphqlMatch[1]);
                        if (userObj && userObj.username) {
                            data.username = userObj.username;
                            data.fullName = userObj.full_name || userObj.fullName;
                            data.bio = userObj.biography;
                            data.followers = userObj.edge_followed_by?.count || userObj.followers_count || userObj.followersCount;
                            data.following = userObj.edge_follow?.count || userObj.follows_count || userObj.followsCount;
                            data.postsCount = userObj.edge_owner_to_timeline_media?.count || userObj.posts_count || userObj.postsCount;
                            data.profileImage = userObj.profile_pic_url || userObj.profilePicUrl;
                            data.website = userObj.external_url || userObj.externalUrl;
                            data.isVerified = userObj.is_verified || userObj.verified || false;
                            data.isBusinessAccount = userObj.is_business_account || userObj.isBusinessAccount || false;
                            
                            log.info(`📊 Extracted from GraphQL user data: ${data.username}`);
                            return false; // Break out of script loop
                        }
                    } catch (e) {
                        // Continue if parsing fails
                    }
                }
                
                // Pattern 2: Profile page data (what feeds the official scraper)
                const profilePagePattern = /"ProfilePage":\s*\[{[^}]*"user":\s*({[^{}]*"biography"[^{}]*})/;
                const profileMatch = content.match(profilePagePattern);
                if (profileMatch) {
                    try {
                        const userObj = JSON.parse(profileMatch[1]);
                        if (userObj && userObj.username && !data.username) {
                            data.username = userObj.username;
                            data.fullName = userObj.full_name || userObj.fullName;
                            data.bio = userObj.biography;
                            data.followers = userObj.edge_followed_by?.count || userObj.followers_count;
                            data.following = userObj.edge_follow?.count || userObj.follows_count;
                            data.postsCount = userObj.edge_owner_to_timeline_media?.count || userObj.posts_count;
                            data.profileImage = userObj.profile_pic_url;
                            data.website = userObj.external_url;
                            data.isVerified = userObj.is_verified || false;
                            data.isBusinessAccount = userObj.is_business_account || false;
                            
                            log.info(`📊 Extracted from ProfilePage data: ${data.username}`);
                            return false;
                        }
                    } catch (e) {
                        // Continue if parsing fails
                    }
                }
                
                // Pattern 3: Direct API response data
                const apiDataPattern = /"data":\s*{[^}]*"user":\s*({[^{}]*"biography"[^{}]*})/;
                const apiMatch = content.match(apiDataPattern);
                if (apiMatch && !data.username) {
                    try {
                        const userObj = JSON.parse(apiMatch[1]);
                        if (userObj && userObj.username) {
                            data.username = userObj.username;
                            data.fullName = userObj.full_name;
                            data.bio = userObj.biography;
                            data.followers = userObj.edge_followed_by?.count || userObj.follower_count;
                            data.following = userObj.edge_follow?.count || userObj.following_count;
                            data.postsCount = userObj.edge_owner_to_timeline_media?.count || userObj.media_count;
                            data.profileImage = userObj.profile_pic_url;
                            data.website = userObj.external_url;
                            data.isVerified = userObj.is_verified || false;
                            data.isBusinessAccount = userObj.is_business_account || false;
                            
                            log.info(`📊 Extracted from API data: ${data.username}`);
                            return false;
                        }
                    } catch (e) {
                        // Continue if parsing fails
                    }
                }
                
                // Pattern 4: Look for individual fields if complete object not found
                if (!data.username) {
                    // Extract individual fields from the largest script (likely to contain profile data)
                    if (content.length > 50000) { // Only check very large scripts
                        const usernameMatch = content.match(/"username":\s*"([^"]+)"/);
                        const fullNameMatch = content.match(/"full_name":\s*"([^"]+)"/);
                        const biographyMatch = content.match(/"biography":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
                        const followersMatch = content.match(/"edge_followed_by":\s*{\s*"count":\s*(\d+)/);
                        const followingMatch = content.match(/"edge_follow":\s*{\s*"count":\s*(\d+)/);
                        const postsMatch = content.match(/"edge_owner_to_timeline_media":\s*{\s*"count":\s*(\d+)/);
                        const profilePicMatch = content.match(/"profile_pic_url":\s*"([^"]+)"/);
                        const externalUrlMatch = content.match(/"external_url":\s*"([^"]+)"/);
                        const verifiedMatch = content.match(/"is_verified":\s*(true|false)/);
                        const businessMatch = content.match(/"is_business_account":\s*(true|false)/);
                        
                        if (usernameMatch) {
                            data.username = usernameMatch[1];
                            data.fullName = fullNameMatch ? fullNameMatch[1] : null;
                            
                            if (biographyMatch) {
                                try {
                                    data.bio = JSON.parse(`"${biographyMatch[1]}"`);
                                } catch (e) {
                                    data.bio = biographyMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ');
                                }
                            }
                            
                            data.followers = followersMatch ? parseInt(followersMatch[1]) : null;
                            data.following = followingMatch ? parseInt(followingMatch[1]) : null;
                            data.postsCount = postsMatch ? parseInt(postsMatch[1]) : null;
                            data.profileImage = profilePicMatch ? profilePicMatch[1] : null;
                            
                            if (externalUrlMatch) {
                                try {
                                    data.website = JSON.parse(`"${externalUrlMatch[1]}"`);
                                } catch (e) {
                                    data.website = externalUrlMatch[1].replace(/\\\//g, '/');
                                }
                            }
                            
                            data.isVerified = verifiedMatch ? verifiedMatch[1] === 'true' : false;
                            data.isBusinessAccount = businessMatch ? businessMatch[1] === 'true' : false;
                            
                            log.info(`📊 Extracted individual fields: ${data.username}`);
                            return false;
                        }
                    }
                }
                
            } catch (e) {
                // Continue if this script fails
            }
        }
    });
    
    // Strategy 2: Fallback to meta tags if JSON parsing failed
    if (!data.username) {
        const ogTitle = $('meta[property="og:title"]').attr('content');
        const ogDescription = $('meta[property="og:description"]').attr('content');
        const ogImage = $('meta[property="og:image"]').attr('content');
        
        if (ogTitle) {
            const usernameMatch = ogTitle.match(/\(@([^)]+)\)/);
            data.username = usernameMatch ? usernameMatch[1] : url.split('/').filter(Boolean).pop();
            data.fullName = ogTitle.replace(/\s*\(@[^)]+\).*$/, '').trim();
        }
        
        if (ogImage) {
            data.profileImage = ogImage;
        }
        
        // Extract stats from meta description
        if (ogDescription) {
            const statsMatch = ogDescription.match(/(\d+(?:,\d+)*[KMB]?)\s*Followers?,\s*(\d+(?:,\d+)*[KMB]?)\s*Following,\s*(\d+(?:,\d+)*[KMB]?)\s*Posts?/i);
            if (statsMatch) {
                data.followers = parseInstagramCount(statsMatch[1]);
                data.following = parseInstagramCount(statsMatch[2]);
                data.postsCount = parseInstagramCount(statsMatch[3]);
            }
        }
        
        log.info(`📊 Extracted from meta tags: ${data.username}`);
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