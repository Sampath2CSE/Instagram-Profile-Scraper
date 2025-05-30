// main.js - Instagram Profile Scraper
import { Actor } from 'apify';
import { PuppeteerCrawler, log } from 'crawlee';

// Initialize the Actor
await Actor.init();

// Get input from the Actor's input schema
const input = await Actor.getInput();
const {
    profileUrls = [],
    proxy = { useApifyProxy: true },
    maxRetries = 3,
    delay = 2000,
    includeRecentPosts = false,
    maxPostsToScrape = 12
} = input;

// Validate input
if (!profileUrls || profileUrls.length === 0) {
    throw new Error('No profile URLs provided. Please add at least one Instagram profile URL.');
}

// Set up proxy configuration
const proxyConfiguration = await Actor.createProxyConfiguration(proxy);

// Initialize the crawler
const crawler = new PuppeteerCrawler({
    proxyConfiguration,
    maxRequestRetries: maxRetries,
    requestHandlerTimeoutSecs: 60,
    
    async requestHandler({ request, page }) {
        const url = request.url;
        log.info(`Processing profile: ${url}`);
        
        try {
            // Wait for the page to load
            await page.waitForSelector('article', { timeout: 30000 });
            
            // Add random delay to mimic human behavior
            await page.waitForTimeout(delay + Math.random() * 1000);
            
            // Extract profile data
            const profileData = await page.evaluate((includeRecentPosts, maxPostsToScrape) => {
                // Helper function to get text content safely
                const getTextContent = (selector) => {
                    const element = document.querySelector(selector);
                    return element ? element.textContent.trim() : null;
                };
                
                // Helper function to get attribute safely
                const getAttribute = (selector, attribute) => {
                    const element = document.querySelector(selector);
                    return element ? element.getAttribute(attribute) : null;
                };
                
                // Extract basic profile information
                const username = getTextContent('h1') || 
                                window.location.pathname.split('/')[1];
                
                const fullName = getTextContent('section div div div div span') ||
                               getTextContent('h1 + div span');
                
                const bio = getTextContent('h1 ~ div span') ||
                           getTextContent('section div div div div:nth-child(3) span');
                
                // Extract profile image
                const profileImage = getAttribute('img[alt*="profile picture"]', 'src') ||
                                   getAttribute('header img', 'src');
                
                // Extract follower/following counts and posts count
                let followers = null, following = null, postsCount = null;
                
                // Look for stats in various possible selectors
                const statsElements = document.querySelectorAll('section div div div div a, section div div div div span');
                statsElements.forEach(element => {
                    const text = element.textContent;
                    if (text.includes('follower')) {
                        followers = text.split(' ')[0];
                    } else if (text.includes('following')) {
                        following = text.split(' ')[0];
                    } else if (text.includes('post')) {
                        postsCount = text.split(' ')[0];
                    }
                });
                
                // Extract website link
                const website = getAttribute('a[href^="http"]', 'href');
                
                // Extract verification status
                const isVerified = document.querySelector('[title="Verified"]') !== null;
                
                // Extract recent posts if requested
                let recentPosts = [];
                if (includeRecentPosts) {
                    const postElements = document.querySelectorAll('article div div div div a');
                    const postsToProcess = Math.min(postElements.length, maxPostsToScrape);
                    
                    for (let i = 0; i < postsToProcess; i++) {
                        const postElement = postElements[i];
                        const postUrl = postElement.href;
                        const postImage = postElement.querySelector('img');
                        
                        if (postImage) {
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
                    followers,
                    following,
                    postsCount,
                    website,
                    isVerified,
                    recentPosts,
                    profileUrl: window.location.href,
                    scrapedAt: new Date().toISOString()
                };
            }, includeRecentPosts, maxPostsToScrape);
            
            // Clean up the data
            const cleanedData = {
                ...profileData,
                followers: profileData.followers ? parseInstagramCount(profileData.followers) : null,
                following: profileData.following ? parseInstagramCount(profileData.following) : null,
                postsCount: profileData.postsCount ? parseInstagramCount(profileData.postsCount) : null
            };
            
            log.info(`Successfully scraped profile: ${cleanedData.username}`);
            
            // Push data to dataset
            await Actor.pushData(cleanedData);
            
        } catch (error) {
            log.error(`Error processing ${url}: ${error.message}`);
            
            // Push error data to dataset for debugging
            await Actor.pushData({
                url,
                error: error.message,
                scrapedAt: new Date().toISOString(),
                status: 'failed'
            });
        }
    },
    
    failedRequestHandler({ request, error }) {
        log.error(`Request ${request.url} failed: ${error.message}`);
    }
});

// Helper function to parse Instagram count format (e.g., "1.2M" -> 1200000)
function parseInstagramCount(countStr) {
    if (!countStr) return null;
    
    const cleanStr = countStr.replace(',', '');
    const multiplier = cleanStr.slice(-1).toLowerCase();
    const number = parseFloat(cleanStr);
    
    switch (multiplier) {
        case 'k':
            return Math.round(number * 1000);
        case 'm':
            return Math.round(number * 1000000);
        case 'b':
            return Math.round(number * 1000000000);
        default:
            return parseInt(cleanStr) || null;
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
        throw new Error('Invalid URL format in profileUrls');
    }
    
    // Ensure the URL is a valid Instagram profile URL
    if (!url.includes('instagram.com/')) {
        throw new Error(`Invalid Instagram URL: ${url}`);
    }
    
    // Remove trailing slash and ensure clean URL
    url = url.replace(/\/$/, '');
    
    return { url };
});

log.info(`Starting to scrape ${requests.length} Instagram profiles`);

// Run the crawler
await crawler.run(requests);

log.info('Instagram profile scraping completed');

// Exit the Actor
await Actor.exit();