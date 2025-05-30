// main.js - Advanced Instagram Profile Scraper with Anti-Detection
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
    minDelay = 3000,
    maxDelay = 7000,
    includeRecentPosts = false,
    maxPostsToScrape = 12,
    useAdvancedFingerprinting = true,
    sessionPersistence = true,
    respectRateLimit = true,
    maxConcurrency = 2,
    randomizeUserBehavior = true
} = input;

// Validate input
if (!profileUrls || profileUrls.length === 0) {
    throw new Error('No profile URLs provided. Please add at least one Instagram profile URL.');
}

// Set up proxy configuration with advanced settings
const proxyConfiguration = await Actor.createProxyConfiguration({
    ...proxy,
    // Use session-based IP rotation for more human-like behavior
    sessionRotationEnabled: sessionPersistence,
    countryCode: 'US', // Default to US proxies for Instagram
});

// Advanced browser fingerprinting configuration
const fingerprintOptions = {
    fingerprintGeneratorOptions: {
        browsers: [
            { name: 'chrome', minVersion: 120, maxVersion: 130 },
            { name: 'firefox', minVersion: 118, maxVersion: 125 },
            { name: 'safari', minVersion: 17, maxVersion: 18 }
        ],
        devices: ['desktop'],
        operatingSystems: ['windows', 'macos'],
        // Vary screen resolutions to avoid fingerprint clustering
        screenResolutions: [
            { width: 1920, height: 1080 },
            { width: 1366, height: 768 },
            { width: 1536, height: 864 },
            { width: 1440, height: 900 }
        ]
    }
};

// Human-like interaction patterns
const humanBehaviorPatterns = {
    scrollPatterns: [
        { distance: 300, duration: 800 },
        { distance: 500, duration: 1200 },
        { distance: 200, duration: 600 }
    ],
    mouseMovements: [
        { x: 100, y: 150, duration: 300 },
        { x: 200, y: 250, duration: 500 },
        { x: 150, y: 300, duration: 400 }
    ]
};

// Initialize the crawler with advanced anti-detection
const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxRequestRetries: maxRetries,
    maxConcurrency: respectRateLimit ? Math.min(maxConcurrency, 2) : maxConcurrency,
    requestHandlerTimeoutSecs: 120,
    
    // Advanced browser configuration
    browserPoolOptions: {
        useFingerprints: useAdvancedFingerprinting,
        fingerprintOptions: useAdvancedFingerprinting ? fingerprintOptions : undefined,
        maxOpenPagesPerBrowser: 1, // Limit pages per browser for memory efficiency
    },
    
    launchContext: {
        launchOptions: {
            // Enhanced browser stealth settings
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection',
                '--enable-features=NetworkService,NetworkServiceInProcess',
                '--disable-background-networking',
                '--disable-sync',
                '--metrics-recording-only',
                '--disable-default-apps',
                '--mute-audio',
                '--disable-web-security',
                '--disable-client-side-phishing-detection',
                '--disable-hang-monitor',
                '--disable-popup-blocking',
                '--disable-prompt-on-repost',
                '--disable-domain-reliability',
                '--disable-component-extensions-with-background-pages'
            ]
        }
    },
    
    // Pre-navigation hook for advanced stealth setup
    preNavigationHooks: [
        async ({ page, request }) => {
            log.info(`Setting up stealth measures for ${request.url}`);
            
            // Enhanced stealth measures - hide automation indicators
            await page.addInitScript(() => {
                // Remove webdriver property
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                
                // Spoof plugins
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5]
                });
                
                // Spoof languages  
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en']
                });
                
                // Override permissions
                const originalQuery = window.navigator.permissions.query;
                window.navigator.permissions.query = (parameters) => (
                    parameters.name === 'notifications' ?
                        Promise.resolve({ state: Notification.permission }) :
                        originalQuery(parameters)
                );
                
                // Hide Chrome automation
                if (window.chrome) {
                    window.chrome.runtime = {
                        onConnect: undefined,
                        onMessage: undefined
                    };
                }
            });
            
            // Set realistic viewport and user agent
            await page.setViewportSize({ 
                width: 1366 + Math.floor(Math.random() * 200), 
                height: 768 + Math.floor(Math.random() * 200) 
            });
            
            // Add realistic headers
            await page.setExtraHTTPHeaders({
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
                'Upgrade-Insecure-Requests': '1'
            });
        }
    ],
    
    async requestHandler({ request, page }) {
        const url = request.url;
        log.info(`Processing profile: ${url}`);
        
        try {
            // Navigate with realistic timing
            const navigationDelay = Math.random() * 2000 + 1000;
            await page.waitForTimeout(navigationDelay);
            
            // Navigate to profile
            await page.goto(url, { 
                waitUntil: 'networkidle', 
                timeout: 30000 
            });
            
            // Human-like behavior simulation
            if (randomizeUserBehavior) {
                await simulateHumanBehavior(page);
            }
            
            // Wait for main content with intelligent selectors
            const contentSelectors = [
                'article',
                'main[role="main"]',
                '[data-testid="user-avatar"]',
                'section'
            ];
            
            let mainContentLoaded = false;
            for (const selector of contentSelectors) {
                try {
                    await page.waitForSelector(selector, { timeout: 10000 });
                    mainContentLoaded = true;
                    break;
                } catch (e) {
                    continue;
                }
            }
            
            if (!mainContentLoaded) {
                throw new Error('Main content did not load within timeout');
            }
            
            // Add intelligent delay based on content loading
            const dynamicDelay = Math.random() * (maxDelay - minDelay) + minDelay;
            await page.waitForTimeout(dynamicDelay);
            
            // Advanced profile data extraction with multiple fallback strategies
            const profileData = await page.evaluate((includeRecentPosts, maxPostsToScrape) => {
                // Multiple extraction strategies for robustness
                const extractionStrategies = {
                    // Strategy 1: Modern Instagram selectors
                    modern: {
                        username: () => {
                            const selectors = [
                                'h1[dir="auto"]',
                                'h1',
                                '[data-testid="user-username"]'
                            ];
                            for (const selector of selectors) {
                                const element = document.querySelector(selector);
                                if (element?.textContent?.trim()) return element.textContent.trim();
                            }
                            return window.location.pathname.split('/')[1] || null;
                        },
                        
                        fullName: () => {
                            const selectors = [
                                'span[dir="auto"]:not(h1 span)',
                                'section div div div div span',
                                '[data-testid="user-full-name"]'
                            ];
                            for (const selector of selectors) {
                                const element = document.querySelector(selector);
                                if (element?.textContent?.trim()) return element.textContent.trim();
                            }
                            return null;
                        },
                        
                        bio: () => {
                            const selectors = [
                                'h1 ~ div span',
                                'section div div div div:nth-child(3) span',
                                '[data-testid="user-bio"]',
                                'div.-vDIg span'
                            ];
                            for (const selector of selectors) {
                                const element = document.querySelector(selector);
                                if (element?.textContent?.trim()) return element.textContent.trim();
                            }
                            return null;
                        },
                        
                        profileImage: () => {
                            const selectors = [
                                'img[alt*="profile picture" i]',
                                'header img',
                                'img[src*="profile"]',
                                'img[style*="border-radius"]'
                            ];
                            for (const selector of selectors) {
                                const element = document.querySelector(selector);
                                if (element?.src) return element.src;
                            }
                            return null;
                        },
                        
                        stats: () => {
                            const stats = { followers: null, following: null, postsCount: null };
                            
                            // Look for stat links and spans
                            const statElements = document.querySelectorAll('a, span');
                            statElements.forEach(element => {
                                const text = element.textContent?.toLowerCase() || '';
                                const numberMatch = text.match(/^([\d,\.kmb]+)/);
                                
                                if (numberMatch) {
                                    const number = numberMatch[1];
                                    if (text.includes('post')) stats.postsCount = number;
                                    else if (text.includes('follower')) stats.followers = number;
                                    else if (text.includes('following')) stats.following = number;
                                }
                            });
                            
                            return stats;
                        },
                        
                        website: () => {
                            const selectors = [
                                'a[href^="http"]:not([href*="instagram.com"])',
                                'a[target="_blank"]'
                            ];
                            for (const selector of selectors) {
                                const element = document.querySelector(selector);
                                if (element?.href) return element.href;
                            }
                            return null;
                        },
                        
                        isVerified: () => {
                            const verificationSelectors = [
                                '[title*="verified" i]',
                                '[alt*="verified" i]',
                                'svg[aria-label*="verified" i]',
                                '.coreSpriteVerifiedBadge'
                            ];
                            return verificationSelectors.some(selector => 
                                document.querySelector(selector) !== null
                            );
                        }
                    }
                };
                
                // Use modern strategy (can be extended with fallbacks)
                const strategy = extractionStrategies.modern;
                
                // Extract basic data
                const username = strategy.username();
                const fullName = strategy.fullName();
                const bio = strategy.bio();
                const profileImage = strategy.profileImage();
                const website = strategy.website();
                const isVerified = strategy.isVerified();
                const stats = strategy.stats();
                
                // Extract recent posts if requested
                let recentPosts = [];
                if (includeRecentPosts) {
                    const postSelectors = [
                        'article div div div div a',
                        'a[href*="/p/"]',
                        'a[href*="/reel/"]'
                    ];
                    
                    let postElements = [];
                    for (const selector of postSelectors) {
                        postElements = document.querySelectorAll(selector);
                        if (postElements.length > 0) break;
                    }
                    
                    const postsToProcess = Math.min(postElements.length, maxPostsToScrape);
                    
                    for (let i = 0; i < postsToProcess; i++) {
                        const postElement = postElements[i];
                        const postUrl = postElement.href;
                        const postImage = postElement.querySelector('img');
                        
                        if (postUrl && postImage) {
                            recentPosts.push({
                                url: postUrl,
                                imageUrl: postImage.src,
                                altText: postImage.alt || ''
                            });
                        }
                    }
                }
                
                return {
                    username,
                    fullName,
                    bio,
                    profileImage,
                    followers: stats.followers,
                    following: stats.following,
                    postsCount: stats.postsCount,
                    website,
                    isVerified,
                    recentPosts,
                    profileUrl: window.location.href,
                    scrapedAt: new Date().toISOString()
                };
            }, includeRecentPosts, maxPostsToScrape);
            
            // Enhanced data validation and cleaning
            const cleanedData = {
                ...profileData,
                followers: profileData.followers ? parseInstagramCount(profileData.followers) : null,
                following: profileData.following ? parseInstagramCount(profileData.following) : null,
                postsCount: profileData.postsCount ? parseInstagramCount(profileData.postsCount) : null,
                // Add extraction confidence score
                extractionConfidence: calculateExtractionConfidence(profileData)
            };
            
            log.info(`Successfully scraped profile: ${cleanedData.username || 'Unknown'} (confidence: ${cleanedData.extractionConfidence}%)`);
            
            // Push data to dataset
            await Actor.pushData(cleanedData);
            
        } catch (error) {
            log.error(`Error processing ${url}: ${error.message}`);
            
            // Enhanced error data for debugging
            await Actor.pushData({
                url,
                error: error.message,
                errorType: error.name,
                scrapedAt: new Date().toISOString(),
                status: 'failed',
                retryCount: request.retryCount || 0
            });
        }
    },
    
    failedRequestHandler({ request, error }) {
        log.error(`Request ${request.url} failed after ${request.retryCount} retries: ${error.message}`);
    }
});

// Advanced human behavior simulation
async function simulateHumanBehavior(page) {
    const actions = [
        // Random mouse movements
        async () => {
            const movement = humanBehaviorPatterns.mouseMovements[
                Math.floor(Math.random() * humanBehaviorPatterns.mouseMovements.length)
            ];
            await page.mouse.move(movement.x, movement.y, { steps: 10 });
            await page.waitForTimeout(movement.duration);
        },
        
        // Realistic scrolling
        async () => {
            const scroll = humanBehaviorPatterns.scrollPatterns[
                Math.floor(Math.random() * humanBehaviorPatterns.scrollPatterns.length)
            ];
            await page.evaluate((distance) => {
                window.scrollBy(0, distance);
            }, scroll.distance);
            await page.waitForTimeout(scroll.duration);
        },
        
        // Random focus events
        async () => {
            await page.focus('body');
            await page.waitForTimeout(200 + Math.random() * 300);
        }
    ];
    
    // Execute 1-3 random actions
    const numActions = Math.floor(Math.random() * 3) + 1;
    for (let i = 0; i < numActions; i++) {
        const action = actions[Math.floor(Math.random() * actions.length)];
        await action();
    }
}

// Enhanced Instagram count parser with better accuracy
function parseInstagramCount(countStr) {
    if (!countStr) return null;
    
    // Handle different Instagram count formats
    const cleanStr = countStr.replace(/[,\s]/g, '').toLowerCase();
    
    // Match number and multiplier
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

// Calculate extraction confidence based on data completeness
function calculateExtractionConfidence(data) {
    const requiredFields = ['username', 'followers', 'following', 'postsCount'];
    const optionalFields = ['fullName', 'bio', 'profileImage', 'website'];
    
    let score = 0;
    let maxScore = 0;
    
    // Required fields (70% of total score)
    requiredFields.forEach(field => {
        maxScore += 17.5; // 70/4 = 17.5 per required field
        if (data[field] !== null && data[field] !== undefined) {
            score += 17.5;
        }
    });
    
    // Optional fields (30% of total score)
    optionalFields.forEach(field => {
        maxScore += 7.5; // 30/4 = 7.5 per optional field
        if (data[field] !== null && data[field] !== undefined) {
            score += 7.5;
        }
    });
    
    return Math.round((score / maxScore) * 100);
}

// Prepare URLs for crawling with enhanced validation
const requests = profileUrls.map(urlInput => {
    let url;
    if (typeof urlInput === 'string') {
        url = urlInput;
    } else if (urlInput.url) {
        url = urlInput.url;
    } else {
        throw new Error('Invalid URL format in profileUrls');
    }
    
    // Enhanced URL validation and normalization
    if (!url.includes('instagram.com/')) {
        throw new Error(`Invalid Instagram URL: ${url}`);
    }
    
    // Normalize URL format
    url = url.replace(/\/$/, '');
    if (!url.includes('://')) {
        url = 'https://' + url;
    }
    
    return { 
        url,
        userData: {
            originalUrl: urlInput
        }
    };
});

log.info(`Starting advanced Instagram scraper for ${requests.length} profiles`);
log.info(`Configuration: Anti-fingerprinting=${useAdvancedFingerprinting}, Concurrency=${maxConcurrency}, Proxy=${proxy.useApifyProxy ? 'Enabled' : 'Disabled'}`);

// Run the crawler
await crawler.run(requests);

log.info('Instagram profile scraping completed successfully');

// Exit the Actor
await Actor.exit();