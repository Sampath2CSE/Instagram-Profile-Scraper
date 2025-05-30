// main.js - Super Enhanced HTTP Instagram Scraper
import { Actor } from 'apify';
import { CheerioCrawler, log } from 'crawlee';

// Advanced window._sharedData parser with multiple strategies
function parseInstagramSharedData(htmlContent) {
    // Strategy 1: Standard _sharedData extraction
    const patterns = [
        /<script[^>]*>window\._sharedData\s*=\s*({.+?});<\/script>/s,
        /window\._sharedData\s*=\s*({.+?});/s,
        /"sharedData"\s*:\s*({.+?})/s,
        /window\._sharedData=({.+?});/s
    ];
    
    for (const pattern of patterns) {
        const match = htmlContent.match(pattern);
        if (match && match[1]) {
            try {
                const sharedData = JSON.parse(match[1]);
                log.info('✅ Found window._sharedData');
                return sharedData;
            } catch (e) {
                log.warning(`Failed parsing _sharedData: ${e.message}`);
            }
        }
    }
    
    // Strategy 2: Look for any large JSON objects containing profile data
    const jsonPatterns = [
        /"ProfilePage"\s*:\s*\[({.+?})\]/s,
        /"graphql"\s*:\s*({.+?"user"\s*:\s*{.+?})/s,
        /"user"\s*:\s*({.+?"biography".+?})/s
    ];
    
    for (const pattern of jsonPatterns) {
        const matches = [...htmlContent.matchAll(pattern)];
        for (const match of matches) {
            try {
                const data = JSON.parse(match[1]);
                if (data.user || data.graphql) {
                    log.info('✅ Found profile data in JSON fragment');
                    return { entry_data: { ProfilePage: [{ graphql: data.graphql || { user: data.user || data } }] } };
                }
            } catch (e) {
                // Continue trying
            }
        }
    }
    
    log.warning('❌ No _sharedData found');
    return null;
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
    maxPostsToScrape = 12,
    usePerProfileProxy = true,
    aggressiveExtraction = true // New option for enhanced extraction
} = input;

// Validate input
if (!profileUrls || profileUrls.length === 0) {
    throw new Error('No profile URLs provided. Please add at least one Instagram profile URL.');
}

// Enhanced proxy pool creation with better error handling
const createEnhancedProxyPool = async (baseProxyConfig, poolSize = 8) => {
    const proxyPool = [];
    const countries = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'NL', 'SE', 'IT', 'ES', 'BR', 'MX'];
    
    for (let i = 0; i < poolSize; i++) {
        try {
            const proxyConfig = {
                ...baseProxyConfig,
                apifyProxyGroups: ['RESIDENTIAL'],
                apifyProxyCountry: countries[i % countries.length]
            };
            
            log.info(`🔧 Creating enhanced proxy config ${i + 1}: RESIDENTIAL - ${countries[i % countries.length]}`);
            
            const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfig);
            proxyPool.push(proxyConfiguration);
            
            log.info(`✅ Created enhanced proxy config ${i + 1}: RESIDENTIAL - ${countries[i % countries.length]}`);
            
        } catch (error) {
            log.warning(`⚠️ Failed proxy config ${i + 1}: ${error.message}`);
            
            // Fallback without country
            try {
                const fallbackConfig = { ...baseProxyConfig, apifyProxyGroups: ['RESIDENTIAL'] };
                const fallbackProxy = await Actor.createProxyConfiguration(fallbackConfig);
                proxyPool.push(fallbackProxy);
                log.info(`✅ Fallback proxy config ${i + 1}: RESIDENTIAL - AUTO`);
            } catch (fallbackError) {
                log.error(`❌ Fallback failed ${i + 1}: ${fallbackError.message}`);
            }
        }
    }
    
    if (proxyPool.length === 0) {
        const defaultProxy = await Actor.createProxyConfiguration(baseProxyConfig);
        proxyPool.push(defaultProxy);
        log.info('✅ Created default proxy configuration');
    }
    
    return proxyPool;
};

// Create proxy pool
let proxyPool = [];
if (usePerProfileProxy) {
    log.info('🔄 Creating enhanced proxy pool...');
    proxyPool = await createEnhancedProxyPool(proxy, Math.min(profileUrls.length * 2, 16));
    log.info(`✅ Created ${proxyPool.length} enhanced proxy configurations`);
} else {
    const singleProxy = await Actor.createProxyConfiguration(proxy);
    proxyPool = [singleProxy];
}

// Enhanced headers with rotation
const getAdvancedHeaders = () => {
    const userAgents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15'
    ];
    
    const acceptLanguages = [
        'en-US,en;q=0.9',
        'en-US,en;q=0.8,es;q=0.7',
        'en-GB,en;q=0.9',
        'en-CA,en;q=0.8,fr;q=0.6'
    ];
    
    return {
        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': acceptLanguages[Math.floor(Math.random() * acceptLanguages.length)],
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
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

// Process single profile with enhanced extraction
async function processEnhancedProfile(profileUrl, proxyIndex) {
    const proxyConfiguration = proxyPool[proxyIndex % proxyPool.length];
    
    log.info(`🎯 Processing ${profileUrl} with enhanced proxy config ${(proxyIndex % proxyPool.length) + 1}`);
    
    const enhancedCrawler = new CheerioCrawler({
        proxyConfiguration,
        maxRequestRetries: maxRetries + 2, // More retries for better success
        maxConcurrency: 1,
        requestHandlerTimeoutSecs: 120,
        maxRequestsPerMinute: 8, // Very conservative
        
        preNavigationHooks: [
            async ({ request }) => {
                // Enhanced headers
                request.headers = {
                    ...request.headers,
                    ...getAdvancedHeaders()
                };
                
                // Longer random delay
                const delay = Math.random() * 8000 + 7000; // 7-15 seconds
                log.info(`⏳ Waiting ${Math.round(delay/1000)}s before request to ${profileUrl}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        ],
        
        async requestHandler({ request, $, body }) {
            const url = request.url;
            log.info(`🔍 Processing: ${url} (Enhanced Proxy ${(proxyIndex % proxyPool.length) + 1})`);
            
            try {
                // Enhanced page validation
                const pageTitle = $('title').text();
                const metaDesc = $('meta[property="og:description"]').attr('content');
                const bodyText = $('body').text();
                
                log.info(`📄 Page title: ${pageTitle}`);
                log.info(`📝 Meta description: ${metaDesc || 'Not found'}`);
                log.info(`📊 Body text length: ${bodyText.length}`);
                log.info(`📊 HTML content length: ${body.length}`);
                
                // Check for blocks/redirects
                if (pageTitle.includes('Login') || body.includes('login_and_signup_page')) {
                    throw new Error('Instagram redirected to login - trying different approach');
                }
                
                if (body.includes('Page Not Found') || $('h2').text().includes("Sorry, this page isn't available")) {
                    throw new Error('Profile not found or unavailable');
                }
                
                // Multi-strategy extraction
                const profileData = await extractWithMultipleStrategies($, url, body);
                
                // Aggressive fallback extraction if needed
                if (aggressiveExtraction) {
                    if (!profileData.bio) {
                        log.info('🔍 Bio missing - applying aggressive extraction...');
                        profileData.bio = extractBioWithAdvancedMethods($, body);
                    }
                    
                    if (!profileData.website) {
                        log.info('🔗 Website missing - applying aggressive extraction...');
                        profileData.website = extractWebsiteWithAdvancedMethods($, body);
                    }
                    
                    if (!profileData.isVerified) {
                        profileData.isVerified = detectVerificationAdvanced($, body);
                    }
                }
                
                // Extract recent posts if requested
                if (includeRecentPosts) {
                    profileData.recentPosts = extractRecentPosts($, maxPostsToScrape);
                }
                
                // Enhanced metadata
                profileData.scrapedAt = new Date().toISOString();
                profileData.profileUrl = url;
                profileData.proxyUsed = `Enhanced Config ${(proxyIndex % proxyPool.length) + 1}`;
                profileData.extractionMethod = 'enhanced-http';
                profileData.contentLength = body.length;
                
                log.info(`✅ SUCCESS: ${profileData.username || 'Unknown'} (Enhanced Proxy ${(proxyIndex % proxyPool.length) + 1})`);
                log.info(`📊 Stats: ${profileData.followers || 'N/A'} followers, ${profileData.following || 'N/A'} following`);
                log.info(`📝 Bio: ${profileData.bio ? '✅ FOUND' : '❌ NOT FOUND'}`);
                log.info(`🔗 Website: ${profileData.website ? '✅ FOUND' : '❌ NOT FOUND'}`);
                log.info(`✅ Verified: ${profileData.isVerified ? '✅ YES' : '❌ NO'}`);
                
                if (profileData.bio) {
                    log.info(`📝 Bio preview: "${profileData.bio.substring(0, 80)}..."`);
                }
                
                await Actor.pushData(profileData);
                return profileData;
                
            } catch (error) {
                log.error(`❌ FAILED: ${url} with enhanced proxy: ${error.message}`);
                
                const errorData = {
                    url,
                    error: error.message,
                    timestamp: new Date().toISOString(),
                    status: 'failed',
                    proxyUsed: `Enhanced Config ${(proxyIndex % proxyPool.length) + 1}`,
                    extractionMethod: 'enhanced-http'
                };
                
                await Actor.pushData(errorData);
                throw error;
            }
        },
        
        failedRequestHandler({ request, error }) {
            log.error(`💥 Request completely failed: ${request.url} - ${error.message}`);
        }
    });
    
    await enhancedCrawler.run([{ url: profileUrl }]);
    await enhancedCrawler.teardown();
}

// Multi-strategy profile data extraction
function extractWithMultipleStrategies($, url, bodyHtml) {
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
    
    // Strategy 1: Enhanced window._sharedData extraction
    log.info('🔍 Strategy 1: Enhanced _sharedData extraction...');
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

            if (user.edge_followed_by && user.edge_followed_by.count !== undefined) {
                data.followers = user.edge_followed_by.count;
            }
            if (user.edge_follow && user.edge_follow.count !== undefined) {
                data.following = user.edge_follow.count;
            }
            if (user.edge_owner_to_timeline_media && user.edge_owner_to_timeline_media.count !== undefined) {
                data.postsCount = user.edge_owner_to_timeline_media.count;
            }
            
            log.info('✅ Strategy 1: SUCCESS - Extracted from _sharedData');
            return data; // If we got data from _sharedData, return it
        }
    }
    
    log.info('⚠️ Strategy 1: No _sharedData found, trying other methods...');
    
    // Strategy 2: JSON-LD structured data
    log.info('🔍 Strategy 2: JSON-LD structured data...');
    const scripts = $('script[type="application/ld+json"]');
    let jsonData = null;
    
    scripts.each((i, script) => {
        try {
            const content = $(script).html();
            if (content && content.includes('"@type":"Person"')) {
                jsonData = JSON.parse(content);
                log.info('✅ Strategy 2: Found JSON-LD data');
                return false;
            }
        } catch (e) {
            // Continue
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
    
    // Strategy 3: Enhanced meta tag extraction
    log.info('🔍 Strategy 3: Enhanced meta tag extraction...');
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const ogDescription = $('meta[property="og:description"]').attr('content');
    const ogImage = $('meta[property="og:image"]').attr('content');
    const twitterTitle = $('meta[name="twitter:title"]').attr('content');
    const metaDescription = $('meta[name="description"]').attr('content');
    
    // Enhanced username extraction
    if (!data.username) {
        const titleSources = [ogTitle, twitterTitle, metaDescription].filter(Boolean);
        
        for (const titleSource of titleSources) {
            const usernamePatterns = [
                /\(@([^)]+)\)/, // "Name (@username)"
                /@([a-zA-Z0-9_.]+)/, // Any @username
                /([a-zA-Z0-9_.]+)\s*•/, // "username •"
            ];
            
            for (const pattern of usernamePatterns) {
                const match = titleSource.match(pattern);
                if (match) {
                    data.username = match[1].trim().replace('@', '');
                    log.info(`✅ Found username from meta: ${data.username}`);
                    break;
                }
            }
            if (data.username) break;
        }
    }
    
    // Fallback username from URL
    if (!data.username) {
        const urlParts = url.split('/').filter(Boolean);
        data.username = urlParts[urlParts.length - 1];
    }
    
    // Enhanced full name extraction
    if (!data.fullName) {
        const titleSources = [ogTitle, twitterTitle].filter(Boolean);
        
        for (const titleSource of titleSources) {
            let cleanName = titleSource;
            cleanName = cleanName.replace(/\s*•.*$/, '');
            cleanName = cleanName.replace(/\s*\(@[^)]+\)/, '');
            cleanName = cleanName.replace(/\s*Instagram photos and videos.*$/, '');
            cleanName = cleanName.replace(/\s*on Instagram.*$/, '');
            cleanName = cleanName.trim();
            
            if (cleanName && cleanName.length > 0 && cleanName.length < 100) {
                data.fullName = cleanName;
                log.info(`✅ Found full name from meta: ${data.fullName}`);
                break;
            }
        }
    }
    
    if (!data.profileImage && ogImage) {
        data.profileImage = ogImage;
    }
    
    // Strategy 4: Enhanced stats extraction from meta description
    log.info('🔍 Strategy 4: Enhanced stats extraction...');
    const metaSources = [ogDescription, metaDescription].filter(Boolean);
    
    for (const metaSource of metaSources) {
        if (data.followers === null || data.following === null || data.postsCount === null) {
            const statsPatterns = [
                /(\d+(?:,\d+)*[KMB]?)\s*Followers?,\s*(\d+(?:,\d+)*[KMB]?)\s*Following,\s*(\d+(?:,\d+)*[KMB]?)\s*Posts?/i,
                /(\d+(?:,\d+)*[KMB]?)\s*followers?,\s*(\d+(?:,\d+)*[KMB]?)\s*following,\s*(\d+(?:,\d+)*[KMB]?)\s*posts?/i,
            ];
            
            for (const pattern of statsPatterns) {
                const match = metaSource.match(pattern);
                if (match && match.length >= 4) {
                    data.followers = data.followers || parseInstagramCount(match[1]);
                    data.following = data.following || parseInstagramCount(match[2]);
                    data.postsCount = data.postsCount || parseInstagramCount(match[3]);
                    log.info(`✅ Found stats from meta: ${data.followers}/${data.following}/${data.postsCount}`);
                    break;
                }
            }
        }
        if (data.followers !== null) break;
    }
    
    // Strategy 5: Enhanced body text stats extraction
    log.info('🔍 Strategy 5: Body text stats extraction...');
    const bodyText = $('body').text();
    
    if (data.followers === null || data.following === null || data.postsCount === null) {
        // More aggressive patterns for body text
        const statPatterns = {
            followers: [
                /(\d+(?:[,\.]\d+)*[KMB]?)\s*followers?/gi,
                /followers?\s*(\d+(?:[,\.]\d+)*[KMB]?)/gi,
                /(\d+(?:[,\.]\d+)*[KMB]?)\s*Followers?/gi
            ],
            following: [
                /(\d+(?:[,\.]\d+)*[KMB]?)\s*following/gi,
                /following\s*(\d+(?:[,\.]\d+)*[KMB]?)/gi,
                /(\d+(?:[,\.]\d+)*[KMB]?)\s*Following/gi
            ],
            posts: [
                /(\d+(?:[,\.]\d+)*[KMB]?)\s*posts?/gi,
                /posts?\s*(\d+(?:[,\.]\d+)*[KMB]?)/gi,
                /(\d+(?:[,\.]\d+)*[KMB]?)\s*Posts?/gi
            ]
        };
        
        Object.entries(statPatterns).forEach(([key, patterns]) => {
            const dataKey = key === 'posts' ? 'postsCount' : key;
            if (data[dataKey] === null) {
                for (const pattern of patterns) {
                    const matches = [...bodyText.matchAll(pattern)];
                    if (matches.length > 0) {
                        data[dataKey] = parseInstagramCount(matches[0][1]);
                        log.info(`✅ Found ${key} from body: ${data[dataKey]}`);
                        break;
                    }
                }
            }
        });
    }
    
    // Clean up zero values
    data.followers = data.followers === 0 ? null : data.followers;
    data.following = data.following === 0 ? null : data.following;
    data.postsCount = data.postsCount === 0 ? null : data.postsCount;

    return data;
}

// Advanced bio extraction with multiple methods
function extractBioWithAdvancedMethods($, bodyHtml) {
    log.info('🔍 Advanced bio extraction starting...');
    
    let foundBio = null;
    
    // Method 1: Enhanced script tag analysis
    $('script').each((i, script) => {
        if (foundBio) return false;
        const content = $(script).html();
        if (content) {
            // Multiple bio field patterns
            const bioPatterns = [
                /"biography":\s*"((?:[^"\\]|\\.)*)"/g,
                /"bio":\s*"((?:[^"\\]|\\.)*)"/g,
                /"description":\s*"((?:[^"\\]|\\.)*)"/g,
                /"about":\s*"((?:[^"\\]|\\.)*)"/g,
                /"summary":\s*"((?:[^"\\]|\\.)*)"/g
            ];
            
            for (const pattern of bioPatterns) {
                const matches = [...content.matchAll(pattern)];
                for (const match of matches) {
                    if (match[1]) {
                        let bioText = match[1]
                            .replace(/\\n/g, '\n')
                            .replace(/\\"/g, '"')
                            .replace(/\\r/g, '\r')
                            .replace(/\\t/g, '\t')
                            .replace(/\\\\/g, '\\');
                        
                        if (bioText && bioText.length > 5 && bioText.length < 1000) {
                            log.info(`📝 Found bio in script: ${bioText}`);
                            foundBio = bioText;
                            return false;
                        }
                    }
                }
            }
        }
    });
    
    if (foundBio) return foundBio;
    
    // Method 2: Enhanced meta description mining
    const metaDescriptions = [
        $('meta[property="og:description"]').attr('content'),
        $('meta[name="description"]').attr('content'),
        $('meta[name="twitter:description"]').attr('content')
    ].filter(Boolean);
    
    for (const metaDesc of metaDescriptions) {
        let cleanMeta = metaDesc;
        
        // Remove stats patterns
        cleanMeta = cleanMeta.replace(/^\d+[KMB]?\s*Followers?,\s*\d+[KMB]?\s*Following,\s*\d+[KMB]?\s*Posts?\s*-\s*/, '');
        cleanMeta = cleanMeta.replace(/See Instagram photos and videos from.*$/i, '');
        cleanMeta = cleanMeta.replace(/\d+[KMB]?\s*followers?,\s*\d+[KMB]?\s*following,\s*\d+[KMB]?\s*posts?/i, '');
        cleanMeta = cleanMeta.trim();
        
        if (cleanMeta && cleanMeta.length > 15 && cleanMeta.length < 500 && 
            !cleanMeta.toLowerCase().includes('instagram') &&
            !cleanMeta.toLowerCase().includes('photos and videos')) {
            log.info(`📝 Found bio from meta description: ${cleanMeta}`);
            return cleanMeta;
        }
    }
    
    // Method 3: Advanced keyword and pattern search
    const bioKeywords = [
        'Digital creator', 'Creator', 'Entrepreneur', 'Founder', 'CEO', 'Coach', 
        'Artist', 'Automation', 'Expert', 'Consultant', 'Specialist', 'Developer',
        'Designer', 'Photographer', 'Influencer', 'Content creator', 'Business owner',
        'Marketing', 'Growth', 'Strategy', 'AI', 'Tech', 'Software', 'Agency',
        'Helping', 'Building', 'Creating', 'Teaching', 'Sharing', 'Passionate about'
    ];
    
    const bodyText = $('body').text();
    
    for (const keyword of bioKeywords) {
        if (bodyText.toLowerCase().includes(keyword.toLowerCase())) {
            log.info(`🎯 Found keyword "${keyword}" in body`);
            
            // Enhanced patterns to extract bio-like content
            const patterns = [
                new RegExp(`([^.!?\\n]*${keyword}[^.!?\\n]*[.!?])`, 'i'),  // Full sentence
                new RegExp(`([^\\n]{0,50}${keyword}[^\\n]{10,200})`, 'i'), // Line with context
                new RegExp(`(${keyword}[^\\n]{10,150})`, 'i')               // Keyword + following text
            ];
            
            for (const pattern of patterns) {
                const match = bodyText.match(pattern);
                if (match && match[1]) {
                    let bio = match[1].trim().replace(/\s+/g, ' ');
                    
                    // Filter out Instagram UI text
                    const unwantedPhrases = [
                        'photos and videos', 'sign up', 'log in', 'instagram',
                        'create account', 'forgot password', 'help', 'about',
                        'terms', 'privacy', 'cookies'
                    ];
                    
                    const isUnwanted = unwantedPhrases.some(phrase => 
                        bio.toLowerCase().includes(phrase.toLowerCase())
                    );
                    
                    if (!isUnwanted && bio.length > 20 && bio.length < 400) {
                        log.info(`📝 Extracted bio via keyword "${keyword}": ${bio}`);
                        return bio;
                    }
                }
            }
        }
    }
    
    log.info('❌ No bio found with advanced extraction');
    return null;
}

// Advanced website extraction
function extractWebsiteWithAdvancedMethods($, bodyHtml) {
    log.info('🔗 Advanced website extraction starting...');
    
    let foundWebsite = null;
    
    // Method 1: Enhanced script analysis for external URLs
    $('script').each((i, script) => {
        if (foundWebsite) return false;
        
        const content = $(script).html();
        if (content) {
            // Look for external_url patterns
            const urlPatterns = [
                /"external_url":\s*"([^"]+)"/g,
                /"website":\s*"([^"]+)"/g,
                /"url":\s*"(https?:\/\/[^"]+)"/g
            ];
            
            for (const pattern of urlPatterns) {
                const matches = [...content.matchAll(pattern)];
                for (const match of matches) {
                    const url = match[1];
                    if (url && !url.includes('instagram.com') && !url.includes('facebook.com')) {
                        log.info(`🔗 Found external URL in script: ${url}`);
                        foundWebsite = url;
                        return false;
                    }
                }
            }
            
            // Look for common bio link services
            const bioLinkPatterns = [
                /(https?:\/\/(?:www\.)?(?:linktr\.ee|bio\.link|linkin\.bio|beacons\.ai|bit\.ly|tinyurl\.com|t\.co)\/[^"'\s]+)/gi,
                /(https?:\/\/[^"'\s]+\.(?:com|org|net|io|co)(?:\/[^"'\s]*)?)/gi
            ];
            
            for (const pattern of bioLinkPatterns) {
                const matches = [...content.matchAll(pattern)];
                for (const match of matches) {
                    const url = match[1];
                    if (!url.includes('instagram.com') && !url.includes('facebook.com') && !url.includes('twitter.com')) {
                        log.info(`🔗 Found bio link in script: ${url}`);
                        foundWebsite = url;
                        return false;
                    }
                }
            }
        }
    });
    
    if (foundWebsite) return foundWebsite;
    
    // Method 2: Look for URLs in visible text and HTML
    const fullHtml = bodyHtml || $('body').html();
    const urlPatterns = [
        /(https?:\/\/(?:www\.)?(?:linktr\.ee|bio\.link|linkin\.bio|beacons\.ai|bit\.ly|tinyurl\.com)\/[\w\.-]+)/gi,
        /(https?:\/\/(?:www\.)?[\w\.-]+\.(?:com|org|net|io|co|me)(?:\/[\w\.-]*)?)/gi
    ];
    
    for (const pattern of urlPatterns) {
        const matches = [...fullHtml.matchAll(pattern)];
        if (matches.length > 0) {
            for (const match of matches) {
                const foundUrl = match[1];
                // Filter out social media and common unwanted URLs
                const unwantedDomains = ['instagram.com', 'facebook.com', 'twitter.com', 'youtube.com', 'tiktok.com'];
                const isUnwanted = unwantedDomains.some(domain => foundUrl.includes(domain));
                
                if (!isUnwanted) {
                    log.info(`🔗 Found URL in HTML: ${foundUrl}`);
                    return foundUrl;
                }
            }
        }
    }
    
    log.info('❌ No website found with advanced extraction');
    return null;
}

// Advanced verification detection
function detectVerificationAdvanced($, bodyHtml) {
    log.info('✅ Advanced verification detection...');
    
    const fullHtml = (bodyHtml || $('body').html()).toLowerCase();
    
    // Enhanced verification selectors
    const verificationSelectors = [
        'svg[aria-label*="verified" i]',
        'img[src*="verified_badge" i]',
        'span[aria-label*="verified" i]',
        'span[title*="verified" i]',
        'div[role="img"][aria-label*="verified" i]',
        '[data-testid="verified_badge"]',
        '[data-testid="verification-badge"]',
        '.verified-badge',
        '._ab6l', // Instagram class that sometimes appears
        '[aria-label*="Verified" i]'
    ];
    
    for (const selector of verificationSelectors) {
        if ($(selector).length > 0) {
            log.info(`✅ Found verification via selector: ${selector}`);
            return true;
        }
    }
    
    // Look for verification in JSON data
    if (fullHtml.includes('"is_verified":true') || fullHtml.includes('"verified":true')) {
        log.info('✅ Found verification in JSON data');
        return true;
    }
    
    // Look for verification text in headers only (to avoid false positives)
    const headerText = $('h1, h2, h3, header').text().toLowerCase();
    if (headerText.includes('verified')) {
        log.info('✅ Found "verified" in header text');
        return true;
    }
    
    log.info('❌ No verification indicators found');
    return false;
}

// Extract recent posts
function extractRecentPosts($, maxPosts) {
    const posts = [];
    
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

// Process all profiles sequentially with enhanced methods
async function processAllProfilesEnhanced() {
    const results = [];
    
    for (let i = 0; i < profileUrls.length; i++) {
        const profileUrl = profileUrls[i];
        let normalizedUrl;
        
        // Normalize URL
        if (typeof profileUrl === 'string') {
            normalizedUrl = profileUrl;
        } else if (profileUrl.url) {
            normalizedUrl = profileUrl.url;
        } else {
            throw new Error('Invalid URL format');
        }
        
        // Validate Instagram URL
        if (!normalizedUrl.includes('instagram.com/')) {
            throw new Error(`Not an Instagram URL: ${normalizedUrl}`);
        }
        
        // Ensure proper format
        normalizedUrl = normalizedUrl.replace(/\/$/, '');
        if (!normalizedUrl.startsWith('http')) {
            normalizedUrl = 'https://' + normalizedUrl;
        }
        
        log.info(`\n🚀 Starting ENHANCED profile ${i + 1}/${profileUrls.length}: ${normalizedUrl}`);
        log.info(`🎯 Using proxy rotation strategy with ${proxyPool.length} available proxies`);
        
        try {
            await processEnhancedProfile(normalizedUrl, i);
            results.push({ url: normalizedUrl, status: 'success' });
            
            // Enhanced wait between profiles
            if (i < profileUrls.length - 1) {
                const waitTime = Math.random() * 20000 + 20000; // 20-40 seconds
                log.info(`⏳ Enhanced waiting ${Math.round(waitTime/1000)}s before next profile...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
            
        } catch (error) {
            log.error(`❌ Enhanced profile ${normalizedUrl} failed completely: ${error.message}`);
            results.push({ url: normalizedUrl, status: 'failed', error: error.message });
        }
    }
    
    return results;
}

// Main execution
log.info(`\n🚀 Starting SUPER ENHANCED HTTP Instagram scraper for ${profileUrls.length} profile(s)`);
log.info(`🔄 Per-profile proxy rotation: ${usePerProfileProxy ? 'ENABLED' : 'DISABLED'}`);
log.info(`🎯 Aggressive extraction: ${aggressiveExtraction ? 'ENABLED' : 'DISABLED'}`);
log.info(`📊 Available proxy configurations: ${proxyPool.length}`);
log.info(`⚡ This enhanced version uses multiple extraction strategies for better bio/website detection`);

const results = await processAllProfilesEnhanced();

log.info('\n📊 FINAL ENHANCED SCRAPING RESULTS:');
log.info('='.repeat(50));

let successCount = 0;
let failCount = 0;

results.forEach((result, index) => {
    const status = result.status === 'success' ? '✅ SUCCESS' : '❌ FAILED';
    log.info(`${index + 1}. ${result.url}`);
    log.info(`   Status: ${status}`);
    
    if (result.status === 'success') {
        successCount++;
    } else {
        failCount++;
        log.info(`   Error: ${result.error}`);
    }
});

log.info('='.repeat(50));
log.info(`📈 SUMMARY: ${successCount} successful, ${failCount} failed out of ${results.length} total`);
log.info(`📊 Success rate: ${Math.round((successCount / results.length) * 100)}%`);

if (successCount > 0) {
    log.info('✅ Enhanced HTTP scraping completed successfully!');
} else {
    log.info('⚠️ No profiles were successfully scraped. Consider checking proxy settings or trying different profiles.');
}

await Actor.exit();