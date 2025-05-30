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

// Simplified bio extraction that targets the same API data
function extractBioFromAnywhere($, bodyHtml) {
    log.info('🔍 Looking for biography in Instagram API data...');
    
    // This function is now redundant since we extract bio in the main function
    // But keeping it for backwards compatibility
    return null;
}

// Simplified website extraction that targets the same API data  
function extractWebsiteFromAnywhere($, bodyHtml) {
    log.info('🔗 Looking for external_url in Instagram API data...');
    
    // This function is now redundant since we extract website in the main function
    // But keeping it for backwards compatibility
    return null;
}

// Enhanced verification detection that targets the same API data
function detectVerification($, bodyHtml) {
    log.info('✅ Looking for verification in Instagram API data...');
    
    // This function is now redundant since we extract verification in the main function
    // But keeping it for backwards compatibility
    return false;
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
                // Method 1a: Look for complete user objects and parse them as JSON
                // This is the most reliable method
                const userObjectRegex = /"user":\s*(\{[^{}]*"biography"[^{}]*\})/g;
                const userMatches = [...content.matchAll(userObjectRegex)];
                
                for (const userMatch of userMatches) {
                    try {
                        const userObj = JSON.parse(userMatch[1]);
                        if (userObj.biography && 
                            userObj.biography.length > 3 && 
                            userObj.biography.length < 500 &&
                            userObj.username) { // Ensure it's a real user object
                            
                            const bio = userObj.biography.trim();
                            // Additional validation - real bios don't contain JSON syntax
                            if (!bio.includes('":') && 
                                !bio.includes('},{') && 
                                !bio.includes('SharingLanding') &&
                                !bio.includes('profilePage')) {
                                
                                log.info(`📝 Found real biography in user object: ${bio}`);
                                foundBio = bio;
                                return false;
                            }
                        }
                    } catch (e) {
                        // Continue if this specific JSON parsing fails
                    }
                }
                
                // Method 1b: Look for GraphQL response data
                if (!foundBio) {
                    const graphqlRegex = /"data":\s*\{[^{}]*"user":\s*(\{[^{}]*"biography"[^{}]*\})/;
                    const graphqlMatch = content.match(graphqlRegex);
                    if (graphqlMatch) {
                        try {
                            const userObj = JSON.parse(graphqlMatch[1]);
                            if (userObj.biography && userObj.biography.length > 3) {
                                const bio = userObj.biography.trim();
                                if (!bio.includes('":') && !bio.includes('SharingLanding')) {
                                    log.info(`📝 Found biography in GraphQL data: ${bio}`);
                                    foundBio = bio;
                                    return false;
                                }
                            }
                        } catch (e) {
                            // Continue if parsing fails
                        }
                    }
                }
                
                // Method 1c: Manual string extraction with strict validation
                if (!foundBio) {
                    const bioPatterns = [
                        /"biography":\s*"([^"]+)"/g
                    ];
                    
                    for (const pattern of bioPatterns) {
                        const matches = [...content.matchAll(pattern)];
                        for (const match of matches) {
                            if (match[1]) {
                                let bioText = match[1];
                                
                                // Decode JSON escapes
                                try {
                                    bioText = JSON.parse(`"${bioText}"`);
                                } catch (e) {
                                    bioText = bioText
                                        .replace(/\\"/g, '"')
                                        .replace(/\\n/g, ' ')
                                        .replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
                                            return String.fromCharCode(parseInt(hex, 16));
                                        });
                                }
                                
                                bioText = bioText.trim();
                                
                                // Strict validation - reject anything that looks like metadata
                                if (bioText.length > 3 && 
                                    bioText.length < 500 &&
                                    !bioText.includes('":') &&
                                    !bioText.includes('},{') &&
                                    !bioText.includes('SharingLanding') &&
                                    !bioText.includes('profilePage') &&
                                    !bioText.includes('canonicalRouteName') &&
                                    !bioText.includes('meta') &&
                                    !bioText.includes('{"') &&
                                    !bioText.includes('"}') &&
                                    !bioText.includes('Instagram photos and videos')) {
                                    
                                    // Additional check: make sure it's human-readable text
                                    if (/^[a-zA-Z0-9\s\p{Emoji}\p{Symbol}\p{Punctuation}]+$/u.test(bioText)) {
                                        log.info(`📝 Found validated biography: ${bioText}`);
                                        foundBio = bioText;
                                        return false;
                                    }
                                }
                            }
                        }
                    }
                }
                
            } catch (e) {
                log.info(`Error parsing bio from script: ${e.message}`);
            }
        }
    });
    
    if (foundBio) return foundBio;
    
    // Method 2: Extract from visible page content
    const bodyText = $('body').text();
    
    // Look for specific bio patterns in the visible text
    const bioIndicators = [
        /Get My [^.!?]*[.!?]/gi,
        /Building [^.!?]*[.!?]/gi,
        /Creating [^.!?]*[.!?]/gi,
        /Helping [^.!?]*[.!?]/gi,
        /Digital creator[^.!?]*[.!?]/gi,
        /AI Automation [^.!?]*[.!?]/gi,
        /Automation Expert[^.!?]*[.!?]/gi,
        /Free [^.!?]*[.!?]/gi,
        /Download [^.!?]*[.!?]/gi,
        /Templates [^.!?]*[.!?]/gi,
        /Incubator [^.!?]*[.!?]/gi
    ];
    
    for (const pattern of bioIndicators) {
        const matches = [...bodyText.matchAll(pattern)];
        for (const match of matches) {
            let bioCandidate = match[0].trim();
            
            // Clean and validate
            if (bioCandidate.length > 10 && 
                bioCandidate.length < 300 && 
                !bioCandidate.includes('posts') &&
                !bioCandidate.includes('followers') &&
                !bioCandidate.includes('following') &&
                !bioCandidate.includes('Instagram')) {
                
                log.info(`📝 Found bio pattern in visible text: ${bioCandidate}`);
                return bioCandidate;
            }
        }
    }
    
    log.info('❌ No valid bio found');
    return null;
}

// Aggressive website extraction from ALL possible sources  
function extractWebsiteFromAnywhere($, bodyHtml) {
    log.info('🔗 Aggressive website extraction starting...');
    
    let foundWebsite = null;
    
    $('script').each((i, script) => {
        if (foundWebsite) return false;
        
        const content = $(script).html();
        if (content && content.includes('"external_url"')) {
            try {
                // Method 1: Parse complete user objects
                const userObjectRegex = /"user":\s*(\{[^{}]*"external_url"[^{}]*\})/g;
                const userMatches = [...content.matchAll(userObjectRegex)];
                
                for (const userMatch of userMatches) {
                    try {
                        const userObj = JSON.parse(userMatch[1]);
                        if (userObj.external_url && 
                            userObj.external_url.includes('http') && 
                            !userObj.external_url.includes('instagram.com')) {
                            
                            log.info(`🔗 Found external_url in user object: ${userObj.external_url}`);
                            foundWebsite = userObj.external_url;
                            return false;
                        }
                    } catch (e) {
                        // Continue if JSON parsing fails
                    }
                }
                
                // Method 2: Direct pattern matching with validation
                if (!foundWebsite) {
                    const urlPattern = /"external_url":\s*"([^"]+)"/g;
                    const urlMatches = [...content.matchAll(urlPattern)];
                    
                    for (const urlMatch of urlMatches) {
                        if (urlMatch[1]) {
                            let url = urlMatch[1];
                            
                            // Decode JSON escapes
                            try {
                                url = JSON.parse(`"${url}"`);
                            } catch (e) {
                                url = url.replace(/\\\//g, '/').replace(/\\"/g, '"');
                            }
                            
                            if (url && 
                                url.includes('http') && 
                                !url.includes('instagram.com') && 
                                !url.includes('facebook.com')) {
                                
                                log.info(`🔗 Found external_url via pattern: ${url}`);
                                foundWebsite = url;
                                return false;
                            }
                        }
                    }
                }
                
            } catch (e) {
                log.info(`Error parsing website from script: ${e.message}`);
            }
        }
    });
    
    if (foundWebsite) return foundWebsite;
    
    // Method 3: Look for bio link services directly in HTML
    const bioLinkServices = ['linktr.ee', 'bio.link', 'linkin.bio', 'beacons.ai'];
    const fullHtml = bodyHtml || $('body').html();
    
    for (const service of bioLinkServices) {
        const serviceRegex = new RegExp(`(https?://)?${service}/[\\w\\.-]+`, 'gi');
        const matches = [...fullHtml.matchAll(serviceRegex)];
        
        if (matches.length > 0) {
            let link = matches[0][0];
            if (!link.startsWith('http')) {
                link = `https://${link}`;
            }
            log.info(`🔗 Found ${service} link in HTML: ${link}`);
            foundWebsite = link;
            break;
        }
    }
    
    if (foundWebsite) return foundWebsite;
    
    log.info('❌ No website found');
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