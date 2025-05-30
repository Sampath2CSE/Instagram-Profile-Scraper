// main.js - Browser-Based Instagram Profile Scraper (Like successful actors)
import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';

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
    waitForContent = 8000, // Wait time for content to load
    blockResources = true  // Block images/videos for faster loading
} = input;

// Validate input
if (!profileUrls || profileUrls.length === 0) {
    throw new Error('No profile URLs provided. Please add at least one Instagram profile URL.');
}

// Create proxy pool for browser-based scraping
const createBrowserProxyPool = async (baseProxyConfig, poolSize = 5) => {
    const proxyPool = [];
    const countries = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'NL', 'SE', 'IT', 'ES'];
    
    for (let i = 0; i < poolSize; i++) {
        try {
            const proxyConfig = {
                ...baseProxyConfig,
                apifyProxyGroups: ['RESIDENTIAL'],
                apifyProxyCountry: countries[i % countries.length]
            };
            
            log.info(`🔧 Creating browser proxy config ${i + 1}: RESIDENTIAL - ${countries[i % countries.length]}`);
            
            const proxyConfiguration = await Actor.createProxyConfiguration(proxyConfig);
            proxyPool.push(proxyConfiguration);
            
            log.info(`✅ Created browser proxy config ${i + 1}: RESIDENTIAL - ${countries[i % countries.length]}`);
            
        } catch (error) {
            log.warning(`⚠️ Failed to create proxy config ${i + 1}: ${error.message}`);
            
            // Fallback without country
            try {
                const fallbackConfig = { ...baseProxyConfig, apifyProxyGroups: ['RESIDENTIAL'] };
                const fallbackProxy = await Actor.createProxyConfiguration(fallbackConfig);
                proxyPool.push(fallbackProxy);
                log.info(`✅ Created fallback proxy config ${i + 1}: RESIDENTIAL - AUTO`);
            } catch (fallbackError) {
                log.error(`❌ Failed fallback proxy ${i + 1}: ${fallbackError.message}`);
            }
        }
    }
    
    if (proxyPool.length === 0) {
        log.warning('⚠️ No proxy configurations created, using default...');
        const defaultProxy = await Actor.createProxyConfiguration(baseProxyConfig);
        proxyPool.push(defaultProxy);
    }
    
    return proxyPool;
};

// Create proxy pool
let proxyPool = [];
if (usePerProfileProxy) {
    log.info('🔄 Creating browser proxy pool...');
    proxyPool = await createBrowserProxyPool(proxy, Math.min(profileUrls.length, 10));
    log.info(`✅ Created ${proxyPool.length} browser proxy configurations`);
} else {
    const singleProxy = await Actor.createProxyConfiguration(proxy);
    proxyPool = [singleProxy];
}

// Process each profile with a dedicated browser instance
async function processProfileWithBrowser(profileUrl, proxyIndex) {
    const proxyConfiguration = proxyPool[proxyIndex % proxyPool.length];
    
    log.info(`🌐 Processing ${profileUrl} with browser proxy config ${(proxyIndex % proxyPool.length) + 1}`);
    
    // Create browser-based crawler for this profile
    const browserCrawler = new PlaywrightCrawler({
        proxyConfiguration,
        maxRequestRetries: maxRetries,
        maxConcurrency: 1,
        requestHandlerTimeoutSecs: 180, // Longer timeout for browser
        
        // Browser launch options
        launchContext: {
            launchOptions: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding'
                ]
            }
        },
        
        // Block resources for faster loading
        preNavigationHooks: [
            async ({ page, request }) => {
                // Block unnecessary resources
                if (blockResources) {
                    await page.route('**/*', (route) => {
                        const resourceType = route.request().resourceType();
                        if (['image', 'media', 'font', 'stylesheet'].includes(resourceType)) {
                            route.abort();
                        } else {
                            route.continue();
                        }
                    });
                }
                
                // Set realistic viewport and user agent
                await page.setViewportSize({ width: 1366, height: 768 });
                await page.setExtraHTTPHeaders({
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Sec-Fetch-Dest': 'document',
                    'Sec-Fetch-Mode': 'navigate',
                    'Sec-Fetch-Site': 'none',
                    'Sec-Fetch-User': '?1',
                    'Upgrade-Insecure-Requests': '1'
                });
                
                log.info(`🌐 Browser navigating to: ${request.url}`);
            }
        ],
        
        async requestHandler({ page, request }) {
            const url = request.url;
            log.info(`🔍 Processing Instagram profile: ${url} (Browser Proxy ${(proxyIndex % proxyPool.length) + 1})`);
            
            try {
                // Wait for page to fully load
                log.info('⏳ Waiting for page content to load...');
                await page.waitForTimeout(waitForContent);
                
                // Wait for potential dynamic content
                try {
                    await page.waitForSelector('article, main, [role="main"]', { timeout: 10000 });
                    log.info('✅ Main content area detected');
                } catch (e) {
                    log.warning('⚠️ Main content selector not found, continuing...');
                }
                
                // Check for login redirect
                const currentUrl = page.url();
                const pageTitle = await page.title();
                
                log.info(`📄 Final URL: ${currentUrl}`);
                log.info(`📄 Page title: ${pageTitle}`);
                
                if (currentUrl.includes('/accounts/login') || pageTitle.includes('Login')) {
                    throw new Error('Instagram redirected to login page - profile may be private or proxy blocked');
                }
                
                if (pageTitle.includes('Page Not Found') || currentUrl.includes('not-found')) {
                    throw new Error('Profile not found or unavailable');
                }
                
                // Get page content for analysis
                const htmlContent = await page.content();
                const bodyText = await page.$eval('body', el => el.innerText).catch(() => '');
                
                log.info(`📊 Page content length: ${htmlContent.length}`);
                log.info(`📊 Body text length: ${bodyText.length}`);
                
                // Extract profile data using browser context
                const profileData = await extractProfileDataFromBrowser(page, url, htmlContent);
                
                // Enhanced bio extraction for browser context
                if (!profileData.bio) {
                    log.info('🔍 Bio not found in initial extraction, trying browser-specific methods...');
                    profileData.bio = await extractBioFromBrowser(page);
                }
                
                // Enhanced website extraction
                if (!profileData.website) {
                    log.info('🔗 Website not found, trying browser-specific extraction...');
                    profileData.website = await extractWebsiteFromBrowser(page);
                }
                
                // Extract recent posts if requested
                if (includeRecentPosts) {
                    profileData.recentPosts = await extractRecentPostsFromBrowser(page, maxPostsToScrape);
                }
                
                // Add metadata
                profileData.scrapedAt = new Date().toISOString();
                profileData.profileUrl = url;
                profileData.proxyUsed = `Browser Config ${(proxyIndex % proxyPool.length) + 1}`;
                profileData.extractionMethod = 'browser';
                
                log.info(`✅ Successfully extracted data for: ${profileData.username || 'Unknown'} (Browser)`);
                log.info(`📊 Stats: ${profileData.followers || 'N/A'} followers, ${profileData.following || 'N/A'} following`);
                log.info(`📝 Bio: ${profileData.bio ? 'Found ✅' : 'Not found ❌'}`);
                log.info(`🔗 Website: ${profileData.website ? 'Found ✅' : 'Not found ❌'}`);
                
                if (profileData.bio) {
                    log.info(`📝 Bio preview: ${profileData.bio.substring(0, 100)}...`);
                }
                
                // Save to dataset
                await Actor.pushData(profileData);
                
                return profileData;
                
            } catch (error) {
                log.error(`❌ Failed to process ${url} with browser: ${error.message}`);
                
                const errorData = {
                    url,
                    error: error.message,
                    timestamp: new Date().toISOString(),
                    status: 'failed',
                    proxyUsed: `Browser Config ${(proxyIndex % proxyPool.length) + 1}`,
                    extractionMethod: 'browser'
                };
                
                await Actor.pushData(errorData);
                throw error;
            }
        },
        
        failedRequestHandler({ request, error }) {
            log.error(`💥 Browser request failed: ${request.url} - ${error.message}`);
        }
    });
    
    // Process the profile
    await browserCrawler.run([{ url: profileUrl }]);
    await browserCrawler.teardown();
}

// Extract profile data from browser page
async function extractProfileDataFromBrowser(page, url, htmlContent) {
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
    
    // Method 1: Try to extract from window._sharedData
    log.info('🔍 Extracting from window._sharedData...');
    const sharedData = await page.evaluate(() => {
        return window._sharedData || null;
    }).catch(() => null);
    
    if (sharedData && sharedData.entry_data && sharedData.entry_data.ProfilePage) {
        const profilePage = sharedData.entry_data.ProfilePage[0];
        if (profilePage && profilePage.graphql && profilePage.graphql.user) {
            const user = profilePage.graphql.user;
            
            data.username = user.username;
            data.fullName = user.full_name;
            data.bio = user.biography;
            data.profileImage = user.profile_pic_url_hd || user.profile_pic_url;
            data.isVerified = user.is_verified;
            data.website = user.external_url;
            
            if (user.edge_followed_by) data.followers = user.edge_followed_by.count;
            if (user.edge_follow) data.following = user.edge_follow.count;
            if (user.edge_owner_to_timeline_media) data.postsCount = user.edge_owner_to_timeline_media.count;
            
            log.info('✅ Successfully extracted from window._sharedData');
            return data;
        }
    }
    
    // Method 2: Extract from page elements using browser selectors
    log.info('🔍 Extracting from page elements...');
    
    try {
        // Get username from URL or page
        data.username = await page.evaluate(() => {
            const h1 = document.querySelector('h1');
            if (h1) {
                const text = h1.innerText;
                const match = text.match(/@([a-zA-Z0-9_.]+)/);
                if (match) return match[1];
            }
            return null;
        }).catch(() => null);
        
        if (!data.username) {
            const urlParts = url.split('/').filter(Boolean);
            data.username = urlParts[urlParts.length - 1];
        }
        
        // Get full name
        data.fullName = await page.evaluate(() => {
            const selectors = [
                'h1', 'h2',
                '[data-testid="user-name"]',
                'header h1',
                'header h2'
            ];
            
            for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element) {
                    let name = element.innerText.trim();
                    name = name.replace(/@[a-zA-Z0-9_.]+/, '').trim();
                    name = name.replace(/•.*$/, '').trim();
                    if (name && name.length > 0 && name.length < 100) {
                        return name;
                    }
                }
            }
            return null;
        }).catch(() => null);
        
        // Get stats using multiple selectors
        const stats = await page.evaluate(() => {
            const result = { followers: null, following: null, posts: null };
            
            // Try multiple selector strategies
            const statSelectors = [
                'a[href*="/followers/"] span',
                'a[href*="/following/"] span',
                'span:has-text("posts")',
                'span:has-text("followers")',
                'span:has-text("following")'
            ];
            
            // Look for numbers near text indicators
            const bodyText = document.body.innerText;
            
            // Follower patterns
            const followerPatterns = [
                /(\d{1,3}(?:,\d{3})*(?:\.\d+)?[KMB]?)\s*followers/gi,
                /followers[\s\n]*(\d{1,3}(?:,\d{3})*(?:\.\d+)?[KMB]?)/gi
            ];
            
            for (const pattern of followerPatterns) {
                const match = bodyText.match(pattern);
                if (match) {
                    result.followers = match[1] || match[0].match(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?[KMB]?)/)?.[1];
                    break;
                }
            }
            
            // Following patterns
            const followingPatterns = [
                /(\d{1,3}(?:,\d{3})*(?:\.\d+)?[KMB]?)\s*following/gi,
                /following[\s\n]*(\d{1,3}(?:,\d{3})*(?:\.\d+)?[KMB]?)/gi
            ];
            
            for (const pattern of followingPatterns) {
                const match = bodyText.match(pattern);
                if (match) {
                    result.following = match[1] || match[0].match(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?[KMB]?)/)?.[1];
                    break;
                }
            }
            
            // Posts patterns
            const postsPatterns = [
                /(\d{1,3}(?:,\d{3})*(?:\.\d+)?[KMB]?)\s*posts/gi,
                /posts[\s\n]*(\d{1,3}(?:,\d{3})*(?:\.\d+)?[KMB]?)/gi
            ];
            
            for (const pattern of postsPatterns) {
                const match = bodyText.match(pattern);
                if (match) {
                    result.posts = match[1] || match[0].match(/(\d{1,3}(?:,\d{3})*(?:\.\d+)?[KMB]?)/)?.[1];
                    break;
                }
            }
            
            return result;
        }).catch(() => ({ followers: null, following: null, posts: null }));
        
        data.followers = parseInstagramCount(stats.followers);
        data.following = parseInstagramCount(stats.following);
        data.postsCount = parseInstagramCount(stats.posts);
        
        // Get profile image
        data.profileImage = await page.evaluate(() => {
            const imgSelectors = [
                'img[data-testid="user-avatar"]',
                'header img',
                'img[alt*="profile picture"]',
                'canvas + img',
                'img[src*="profile"]'
            ];
            
            for (const selector of imgSelectors) {
                const img = document.querySelector(selector);
                if (img && img.src && !img.src.includes('data:')) {
                    return img.src;
                }
            }
            return null;
        }).catch(() => null);
        
        // Check verification
        data.isVerified = await page.evaluate(() => {
            const verificationSelectors = [
                'svg[aria-label*="Verified" i]',
                'svg[aria-label*="verified" i]',
                '[data-testid="verified-badge"]',
                'span[title*="Verified" i]'
            ];
            
            return verificationSelectors.some(selector => document.querySelector(selector));
        }).catch(() => false);
        
    } catch (error) {
        log.warning(`⚠️ Error extracting from page elements: ${error.message}`);
    }
    
    return data;
}

// Extract bio using browser-specific methods
async function extractBioFromBrowser(page) {
    log.info('🔍 Browser-specific bio extraction...');
    
    try {
        const bio = await page.evaluate(() => {
            // Try multiple bio selectors
            const bioSelectors = [
                '[data-testid="bio"]',
                'header div[data-testid="bio"]',
                'span[dir="auto"]',
                'div[data-testid="user-bio"]',
                'article div span',
                'main div span[dir="auto"]'
            ];
            
            for (const selector of bioSelectors) {
                const elements = document.querySelectorAll(selector);
                for (const element of elements) {
                    const text = element.innerText.trim();
                    if (text && 
                        text.length > 10 && 
                        text.length < 500 && 
                        !text.includes('followers') && 
                        !text.includes('following') &&
                        !text.includes('posts') &&
                        !text.includes('Sign up') &&
                        !text.includes('Log in')) {
                        return text;
                    }
                }
            }
            
            // Try to find bio in any span with reasonable length
            const allSpans = document.querySelectorAll('span');
            for (const span of allSpans) {
                const text = span.innerText.trim();
                if (text && 
                    text.length > 15 && 
                    text.length < 400 &&
                    (text.includes('•') || text.includes('|') || text.includes('📧') || 
                     text.includes('👆') || text.includes('👇') || text.includes('DM') ||
                     text.toLowerCase().includes('helping') || text.toLowerCase().includes('creator') ||
                     text.toLowerCase().includes('founder') || text.toLowerCase().includes('ceo'))) {
                    return text;
                }
            }
            
            return null;
        });
        
        if (bio) {
            log.info(`📝 Found bio via browser: ${bio.substring(0, 100)}...`);
            return bio;
        }
        
    } catch (error) {
        log.warning(`⚠️ Browser bio extraction error: ${error.message}`);
    }
    
    return null;
}

// Extract website using browser-specific methods  
async function extractWebsiteFromBrowser(page) {
    log.info('🔗 Browser-specific website extraction...');
    
    try {
        const website = await page.evaluate(() => {
            // Look for external links
            const linkSelectors = [
                'a[href*="linktr.ee"]',
                'a[href*="bio.link"]',
                'a[href*="linkin.bio"]',
                'a[href*="beacons.ai"]',
                'a[href^="http"]:not([href*="instagram.com"]):not([href*="facebook.com"])',
                '[data-testid="bio"] a',
                'header a[href^="http"]'
            ];
            
            for (const selector of linkSelectors) {
                const link = document.querySelector(selector);
                if (link && link.href && !link.href.includes('instagram.com')) {
                    return link.href;
                }
            }
            
            return null;
        });
        
        if (website) {
            log.info(`🔗 Found website via browser: ${website}`);
            return website;
        }
        
    } catch (error) {
        log.warning(`⚠️ Browser website extraction error: ${error.message}`);
    }
    
    return null;
}

// Extract recent posts using browser
async function extractRecentPostsFromBrowser(page, maxPosts) {
    try {
        const posts = await page.evaluate((max) => {
            const posts = [];
            const postLinks = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
            
            for (let i = 0; i < Math.min(postLinks.length, max); i++) {
                const link = postLinks[i];
                const img = link.querySelector('img');
                
                if (link.href && img) {
                    posts.push({
                        url: link.href,
                        imageUrl: img.src,
                        altText: img.alt || ''
                    });
                }
            }
            
            return posts;
        }, maxPosts);
        
        return posts;
    } catch (error) {
        log.warning(`⚠️ Error extracting posts: ${error.message}`);
        return [];
    }
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

// Process all profiles sequentially
async function processAllProfiles() {
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
        
        log.info(`\n🚀 Starting browser profile ${i + 1}/${profileUrls.length}: ${normalizedUrl}`);
        
        try {
            await processProfileWithBrowser(normalizedUrl, i);
            results.push({ url: normalizedUrl, status: 'success' });
            
            // Wait between profiles
            if (i < profileUrls.length - 1) {
                const waitTime = Math.random() * 15000 + 15000; // 15-30 seconds
                log.info(`⏳ Waiting ${Math.round(waitTime/1000)}s before next profile...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
            
        } catch (error) {
            log.error(`❌ Profile ${normalizedUrl} failed: ${error.message}`);
            results.push({ url: normalizedUrl, status: 'failed', error: error.message });
        }
    }
    
    return results;
}

// Main execution
log.info(`🚀 Starting BROWSER-BASED Instagram scraper for ${profileUrls.length} profile(s)`);
log.info(`🔄 Per-profile proxy rotation: ${usePerProfileProxy ? 'ENABLED' : 'DISABLED'}`);
log.info(`⏱️  Content wait time: ${waitForContent}ms`);
log.info(`🚫 Resource blocking: ${blockResources ? 'ENABLED' : 'DISABLED'}`);

const results = await processAllProfiles();

log.info('\n📊 FINAL BROWSER SCRAPING RESULTS:');
results.forEach((result, index) => {
    log.info(`${index + 1}. ${result.url}: ${result.status.toUpperCase()}`);
    if (result.error) {
        log.info(`   Error: ${result.error}`);
    }
});

log.info('✅ Browser-based Instagram scraping completed!');
await Actor.exit();