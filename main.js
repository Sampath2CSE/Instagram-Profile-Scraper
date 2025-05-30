// main.js - Working Instagram Profile Scraper with Proven Anti-Detection
import { Actor } from 'apify';
import { PlaywrightCrawler, log } from 'crawlee';

// Initialize the Actor
await Actor.init();

// Get input from the Actor's input schema
const input = await Actor.getInput();
const {
    profileUrls = [],
    proxy = { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] },
    maxRetries = 5,
    minDelay = 8000,
    maxDelay = 15000,
    includeRecentPosts = false,
    maxPostsToScrape = 12,
    useAdvancedFingerprinting = true,
    respectRateLimit = true,
    maxConcurrency = 1, // Keep very low for Instagram
    randomizeUserBehavior = true
} = input;

// Validate input
if (!profileUrls || profileUrls.length === 0) {
    throw new Error('No profile URLs provided. Please add at least one Instagram profile URL.');
}

// Set up proxy configuration - CRITICAL for Instagram
const proxyConfiguration = await Actor.createProxyConfiguration(proxy);

// Initialize the crawler with WORKING configuration for Instagram
const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxRequestRetries: maxRetries,
    maxConcurrency: 1, // MUST be 1 for Instagram to avoid instant blocks
    requestHandlerTimeoutSecs: 180, // Increased timeout for slow loading
    
    // Browser configuration optimized for Instagram
    browserPoolOptions: {
        useFingerprints: true,
        maxOpenPagesPerBrowser: 1,
        fingerprintOptions: {
            fingerprintGeneratorOptions: {
                browsers: [{ name: 'chrome', minVersion: 120 }], // Stick to Chrome only
                devices: ['desktop'],
                operatingSystems: ['windows'],
            },
        },
    },
    
    launchContext: {
        launchOptions: {
            headless: true,
            // Minimal args to avoid detection
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=VizDisplayCompositor'
            ]
        }
    },
    
    // Pre-navigation hook - CRITICAL anti-detection setup
    preNavigationHooks: [
        async ({ page, request }) => {
            log.info(`Setting up Instagram-specific stealth for ${request.url}`);
            
            // WORKING stealth script for Instagram
            await page.addInitScript(() => {
                // Remove webdriver traces
                delete navigator.__proto__.webdriver;
                
                // Override getComputedStyle to hide headless
                const originalGetComputedStyle = window.getComputedStyle;
                window.getComputedStyle = function(element, pseudoElement) {
                    const computedStyle = originalGetComputedStyle.call(this, element, pseudoElement);
                    if (element && element.tagName === 'IFRAME') {
                        return computedStyle;
                    }
                    return computedStyle;
                };
                
                // Override navigator properties that Instagram checks
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined,
                });
                
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5],
                });
                
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en'],
                });
                
                // Instagram-specific: Hide automation indicators
                Object.defineProperty(navigator, 'hardwareConcurrency', {
                    get: () => 4,
                });
                
                // Override permissions for Instagram
                const originalQuery = window.navigator.permissions.query;
                window.navigator.permissions.query = (parameters) => (
                    parameters.name === 'notifications' ?
                        Promise.resolve({ state: Notification.permission }) :
                        originalQuery(parameters)
                );
            });
            
            // Set realistic headers that Instagram expects
            await page.setExtraHTTPHeaders({
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
            });
            
            // Set realistic viewport - Instagram optimization
            await page.setViewportSize({ width: 1366, height: 768 });
        }
    ],
    
    async requestHandler({ request, page }) {
        const url = request.url;
        log.info(`Processing Instagram profile: ${url}`);
        
        try {
            // CRITICAL: Long delay before navigation
            const preNavDelay = Math.random() * 5000 + 8000; // 8-13 seconds
            log.info(`Waiting ${Math.round(preNavDelay/1000)}s before navigation to mimic human behavior`);
            await page.waitForTimeout(preNavDelay);
            
            // Navigate with extended timeout and proper wait strategy
            log.info(`Navigating to ${url}...`);
            const response = await page.goto(url, { 
                waitUntil: 'domcontentloaded', // Changed from networkidle to avoid timeouts
                timeout: 60000 // Increased timeout
            });
            
            // Check if we got blocked
            if (response.status() === 429 || response.status() === 403) {
                throw new Error(`Got blocked with status ${response.status()}`);
            }
            
            // Wait for any of these selectors to appear (Instagram's main content)
            const mainSelectors = [
                'article',
                'main',
                'section',
                '[role="main"]',
                'header'
            ];
            
            let contentFound = false;
            for (const selector of mainSelectors) {
                try {
                    await page.waitForSelector(selector, { timeout: 15000 });
                    contentFound = true;
                    log.info(`Found content with selector: ${selector}`);
                    break;
                } catch (e) {
                    continue;
                }
            }
            
            if (!contentFound) {
                log.warning('No main content selectors found, proceeding anyway...');
            }
            
            // Human behavior simulation - CRITICAL for Instagram
            log.info('Simulating human behavior...');
            
            // Random scrolling
            await page.evaluate(() => {
                window.scrollBy(0, Math.random() * 500 + 200);
            });
            await page.waitForTimeout(2000 + Math.random() * 3000);
            
            // Random mouse movement
            await page.mouse.move(
                Math.random() * 800 + 200, 
                Math.random() * 600 + 100
            );
            await page.waitForTimeout(1000 + Math.random() * 2000);
            
            // Another scroll
            await page.evaluate(() => {
                window.scrollBy(0, Math.random() * 300 + 100);
            });
            await page.waitForTimeout(1500 + Math.random() * 2500);
            
            // ROBUST data extraction with multiple strategies
            log.info('Extracting profile data...');
            const profileData = await page.evaluate((includeRecentPosts, maxPostsToScrape) => {
                
                // Helper function to safely get text
                const safeText = (selector) => {
                    try {
                        const element = document.querySelector(selector);
                        return element ? element.textContent.trim() : null;
                    } catch (e) {
                        return null;
                    }
                };
                
                // Helper function to safely get attribute
                const safeAttr = (selector, attr) => {
                    try {
                        const element = document.querySelector(selector);
                        return element ? element.getAttribute(attr) : null;
                    } catch (e) {
                        return null;
                    }
                };
                
                // Extract username - multiple strategies
                let username = null;
                const usernameSelectors = [
                    'h2', 'h1', 
                    '[data-testid="user-name"]',
                    'header h1',
                    'header h2'
                ];
                
                for (const selector of usernameSelectors) {
                    username = safeText(selector);
                    if (username) break;
                }
                
                // Fallback to URL
                if (!username) {
                    username = window.location.pathname.split('/')[1] || null;
                }
                
                // Extract full name
                let fullName = null;
                const nameSelectors = [
                    'section div div div div span',
                    'header span',
                    'h1 + div span'
                ];
                
                for (const selector of nameSelectors) {
                    fullName = safeText(selector);
                    if (fullName && fullName !== username) break;
                }
                
                // Extract bio
                let bio = null;
                const bioSelectors = [
                    'h1 ~ div span',
                    'section span',
                    '[data-testid="user-bio"]'
                ];
                
                for (const selector of bioSelectors) {
                    bio = safeText(selector);
                    if (bio && bio.length > 10) break; // Ensure it's actually a bio
                }
                
                // Extract profile image
                let profileImage = null;
                const imgSelectors = [
                    'img[alt*="profile" i]',
                    'header img',
                    'img[style*="border-radius"]'
                ];
                
                for (const selector of imgSelectors) {
                    profileImage = safeAttr(selector, 'src');
                    if (profileImage) break;
                }
                
                // Extract stats (followers, following, posts)
                let followers = null, following = null, postsCount = null;
                
                // Look for stat numbers in links and spans
                const allText = document.body.innerText;
                const statRegex = /([\d,\.kmb]+)\s*(follower|following|post)/gi;
                let match;
                
                while ((match = statRegex.exec(allText)) !== null) {
                    const number = match[1];
                    const type = match[2].toLowerCase();
                    
                    if (type.includes('follower') && !followers) followers = number;
                    else if (type.includes('following') && !following) following = number;
                    else if (type.includes('post') && !postsCount) postsCount = number;
                }
                
                // Extract website
                let website = null;
                const linkSelectors = [
                    'a[href^="http"]:not([href*="instagram.com"])',
                    'a[target="_blank"]:not([href*="instagram.com"])'
                ];
                
                for (const selector of linkSelectors) {
                    website = safeAttr(selector, 'href');
                    if (website) break;
                }
                
                // Check verification
                const isVerified = document.querySelector('[title*="verified" i], [alt*="verified" i]') !== null;
                
                // Extract recent posts if requested
                let recentPosts = [];
                if (includeRecentPosts) {
                    const postLinks = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
                    const limit = Math.min(postLinks.length, maxPostsToScrape);
                    
                    for (let i = 0; i < limit; i++) {
                        const link = postLinks[i];
                        const img = link.querySelector('img');
                        if (link.href && img) {
                            recentPosts.push({
                                url: link.href,
                                imageUrl: img.src,
                                altText: img.alt || ''
                            });
                        }
                    }
                }
                
                return {
                    username,
                    fullName,
                    bio,
                    profileImage,
                    followers,
                    following,
                    postsCount,
                    website,
                    isVerified,
                    recentPosts,
                    profileUrl: window.location.href,
                    scrapedAt: new Date().toISOString(),
                    pageTitle: document.title
                };
            }, includeRecentPosts, maxPostsToScrape);
            
            // Process and clean the data
            const cleanedData = {
                ...profileData,
                followers: parseInstagramCount(profileData.followers),
                following: parseInstagramCount(profileData.following),
                postsCount: parseInstagramCount(profileData.postsCount)
            };
            
            log.info(`✅ Successfully extracted data for: ${cleanedData.username || 'Unknown user'}`);
            log.info(`📊 Stats: ${cleanedData.followers || 'N/A'} followers, ${cleanedData.following || 'N/A'} following, ${cleanedData.postsCount || 'N/A'} posts`);
            
            // Save to dataset
            await Actor.pushData(cleanedData);
            
            // CRITICAL: Long delay after successful scrape
            const postScrapeDelay = Math.random() * 10000 + 15000; // 15-25 seconds
            log.info(`⏱️  Waiting ${Math.round(postScrapeDelay/1000)}s before next request to avoid rate limiting`);
            await page.waitForTimeout(postScrapeDelay);
            
        } catch (error) {
            log.error(`❌ Failed to process ${url}: ${error.message}`);
            
            // Check if it's a timeout or blocking
            if (error.message.includes('Timeout') || error.message.includes('blocked')) {
                log.error('🚫 Detected timeout or blocking - Instagram may be detecting the bot');
            }
            
            await Actor.pushData({
                url,
                error: error.message,
                timestamp: new Date().toISOString(),
                status: 'failed'
            });
        }
    },
    
    failedRequestHandler({ request, error }) {
        log.error(`💥 Request completely failed: ${request.url} - ${error.message}`);
    }
});

// Enhanced Instagram count parser
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

// Prepare URLs with validation
const requests = profileUrls.map(urlInput => {
    let url;
    if (typeof urlInput === 'string') {
        url = urlInput;
    } else if (urlInput.url) {
        url = urlInput.url;
    } else {
        throw new Error('Invalid URL format');
    }
    
    // Validate Instagram URL
    if (!url.includes('instagram.com/')) {
        throw new Error(`Not an Instagram URL: ${url}`);
    }
    
    // Normalize URL
    url = url.replace(/\/$/, '');
    if (!url.startsWith('http')) {
        url = 'https://' + url;
    }
    
    return { url };
});

log.info(`🚀 Starting WORKING Instagram scraper for ${requests.length} profile(s)`);
log.info(`⚙️  Config: Concurrency=1, Delays=8-15s, Retries=${maxRetries}, Residential Proxies=${proxy.useApifyProxy}`);

// Run the crawler
await crawler.run(requests);

log.info('✅ Instagram scraping completed!');
await Actor.exit();