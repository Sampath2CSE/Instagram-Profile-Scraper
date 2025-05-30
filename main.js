// main.js - Working Instagram Profile Scraper (HTTP-based like Apify's official version)
import { Actor }

// Aggressive bio extraction from ALL possible sources
function extractBioFromAnywhere($, bodyHtml) {
    log.info('🔍 Aggressive bio extraction starting...');
    
    // Method 1: Look in ALL script tags for JSON data
    $('script').each((i, script) => {
        const content = $(script).html();
        if (content) {
            // Look for biography in JSON
            const bioMatches = content.match(/"biography":\s*"([^"]+)"/g);
            if (bioMatches) {
                bioMatches.forEach(match => {
                    const bioText = match.match(/"biography":\s*"([^"]+)"/)[1];
                    if (bioText && bioText.length > 3) {
                        log.info(`📝 Found bio in script: ${bioText}`);
                        return bioText;
                    }
                });
            }
            
            // Look for any description fields
            const descMatches = content.match(/"description":\s*"([^"]+)"/g);
            if (descMatches) {
                descMatches.forEach(match => {
                    const descText = match.match(/"description":\s*"([^"]+)"/)[1];
                    if (descText && descText.length > 10 && !descText.includes('See Instagram photos')) {
                        log.info(`📝 Found description in script: ${descText}`);
                        return descText;
                    }
                });
            }
        }
    });
    
    // Method 2: Look in raw HTML for common bio patterns
    const bioKeywords = ['Digital creator', 'Creator', 'Entrepreneur', 'Founder', 'CEO', 'Coach', 'Artist', 'Automation', 'Expert'];
    const bodyText = $('body').text();
    
    for (const keyword of bioKeywords) {
        if (bodyText.includes(keyword)) {
            log.info(`🎯 Found keyword "${keyword}" in body`);
            
            // Extract text around this keyword
            const regex = new RegExp(`${keyword}[^0-9]*?(?=\\d+|$)`, 'i');
            const match = bodyText.match(regex);
            if (match && match[0]) {
                let bio = match[0].trim();
                bio = bio.replace(/\s+/g, ' ');
                if (bio.length > 10 && bio.length < 500) {
                    log.info(`📝 Extracted bio around keyword: ${bio}`);
                    return bio;
                }
            }
        }
    }
    
    // Method 3: Look in HTML attributes and data attributes
    const bioSelectors = [
        '[data-bio]',
        '[data-description]', 
        '.bio',
        '.description',
        '.profile-bio'
    ];
    
    for (const selector of bioSelectors) {
        const element = $(selector);
        if (element.length) {
            const bioText = element.text() || element.attr('data-bio') || element.attr('data-description');
            if (bioText && bioText.length > 10) {
                log.info(`📝 Found bio in selector ${selector}: ${bioText}`);
                return bioText.trim();
            }
        }
    }
    
    log.info('❌ No bio found with aggressive extraction');
    return null;
}

// Aggressive website extraction from ALL possible sources  
function extractWebsiteFromAnywhere($, bodyHtml) {
    log.info('🔗 Aggressive website extraction starting...');
    
    // Method 1: Look in ALL script tags for external URLs
    $('script').each((i, script) => {
        const content = $(script).html();
        if (content) {
            // Look for external_url in JSON
            const urlMatches = content.match(/"external_url":\s*"([^"]+)"/g);
            if (urlMatches) {
                urlMatches.forEach(match => {
                    const url = match.match(/"external_url":\s*"([^"]+)"/)[1];
                    if (url && !url.includes('instagram.com')) {
                        log.info(`🔗 Found external_url in script: ${url}`);
                        return url;
                    }
                });
            }
            
            // Look for any linktr.ee or common bio links
            const bioLinkMatches = content.match(/(linktr\.ee\/[^"'\s]+|bio\.link\/[^"'\s]+)/gi);
            if (bioLinkMatches) {
                const link = bioLinkMatches[0];
                log.info(`🔗 Found bio link in script: ${link}`);
                return link.startsWith('http') ? link : `https://${link}`;
            }
        }
    });
    
    // Method 2: Look in raw HTML for URL patterns
    const urlPatterns = [
        /(linktr\.ee\/[\w\.-]+)/gi,
        /(bio\.link\/[\w\.-]+)/gi,
        /(linkin\.bio\/[\w\.-]+)/gi,
        /(beacons\.ai\/[\w\.-]+)/gi,
        /(bit\.ly\/[\w\.-]+)/gi,
        /(tinyurl\.com\/[\w\.-]+)/gi,
        /([\w-]+\.com\/[\w\.-]*)/gi
    ];
    
    const fullHtml = bodyHtml || $('body').html();
    
    for (const pattern of urlPatterns) {
        const matches = [...fullHtml.matchAll(pattern)];
        if (matches.length > 0) {
            const foundUrl = matches[0][1];
            if (!foundUrl.includes('instagram.com') && !foundUrl.includes('facebook.com')) {
                const website = foundUrl.startsWith('http') ? foundUrl : `https://${foundUrl}`;
                log.info(`🔗 Found URL via pattern: ${website}`);
                return website;
            }
        }
    }
    
    // Method 3: Look in ALL link elements
    const allLinks = [];
    $('a').each((i, link) => {
        const href = $(link).attr('href');
        const text = $(link).text();
        if (href) {
            allLinks.push({ href, text });
        }
    });
    
    log.info(`🔍 Found ${allLinks.length} total links`);
    
    for (const link of allLinks) {
        if (link.href && 
            link.href.startsWith('http') && 
            !link.href.includes('instagram.com') && 
            !link.href.includes('facebook.com') &&
            !link.href.includes('google.com')) {
            log.info(`🔗 Found external link: ${link.href} (text: ${link.text})`);
            return link.href;
        }
    }
    
    log.info('❌ No website found with aggressive extraction');
    return null;
}

// Aggressive verification detection
function detectVerification($, bodyHtml) {
    log.info('✅ Checking verification status...');
    
    const bodyText = $('body').text().toLowerCase();
    const fullHtml = (bodyHtml || $('body').html()).toLowerCase();
    
    // Check for various verification indicators
    const verificationIndicators = [
        'verified',
        'blue checkmark',
        'blue check',
        'verified account',
        'verification badge',
        'checkmark'
    ];
    
    for (const indicator of verificationIndicators) {
        if (bodyText.includes(indicator) || fullHtml.includes(indicator)) {
            log.info(`✅ Found verification indicator: ${indicator}`);
            return true;
        }
    }
    
    // Check for verification in script tags
    $('script').each((i, script) => {
        const content = $(script).html();
        if (content && content.toLowerCase().includes('verified')) {
            log.info('✅ Found verification in script tag');
            return true;
        }
    });
    
    // Check for SVG or icon elements that might indicate verification
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
    return false; from 'apify';
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
            
            // Debug: Show a sample of the body text to understand the structure
            const bodyPreview = bodyText.substring(0, 500);
            log.info(`Body text preview: ${bodyPreview}`);
            
            // Debug: Look for bio-related text
            const bioKeywords = ['Digital creator', 'creator', 'entrepreneur', 'linktr.ee', 'bio.link'];
            bioKeywords.forEach(keyword => {
                if (bodyText.toLowerCase().includes(keyword.toLowerCase())) {
                    log.info(`Found keyword "${keyword}" in body text`);
                    const index = bodyText.toLowerCase().indexOf(keyword.toLowerCase());
                    const context = bodyText.substring(Math.max(0, index - 50), index + 100);
                    log.info(`Context around "${keyword}": ${context}`);
                }
            });
            
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
    
    log.info(`OG Title: ${ogTitle}`);
    log.info(`OG Description: ${ogDescription}`);
    
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
    
    // Strategy 3: Extract bio from body text (simplified approach)
    const bodyText = $('body').text();
    
    if (!data.bio) {
        // Simple approach: look for common bio indicators and extract surrounding text
        const bioIndicators = [
            'Digital creator',
            'Creator',
            'Entrepreneur', 
            'Founder',
            'CEO',
            'Artist',
            'Influencer',
            'Coach',
            'Consultant'
        ];
        
        for (const indicator of bioIndicators) {
            if (bodyText.includes(indicator)) {
                log.info(`Found bio indicator: ${indicator}`);
                // Get the text around this indicator
                const index = bodyText.indexOf(indicator);
                const beforeText = bodyText.substring(Math.max(0, index - 100), index);
                const afterText = bodyText.substring(index, index + 200);
                
                log.info(`Text before indicator: ${beforeText}`);
                log.info(`Text after indicator: ${afterText}`);
                
                // Extract a reasonable bio from the surrounding text
                // Look for text that follows common patterns
                const bioMatch = afterText.match(/^([^0-9]+?)(?=\d|\s*$)/);
                if (bioMatch && bioMatch[1]) {
                    let extractedBio = bioMatch[1].trim();
                    // Clean up the bio
                    extractedBio = extractedBio.replace(/\s+/g, ' ');
                    extractedBio = extractedBio.replace(/^(posts|followers|following)\s*/i, '');
                    
                    if (extractedBio.length > 10 && extractedBio.length < 300) {
                        data.bio = extractedBio;
                        log.info(`Extracted bio: ${data.bio}`);
                        break;
                    }
                }
            }
        }
    }
    
    // Alternative bio extraction: look for text patterns between name and stats
    if (!data.bio && data.fullName) {
        const nameIndex = bodyText.indexOf(data.fullName);
        if (nameIndex !== -1) {
            // Get text after the name
            const textAfterName = bodyText.substring(nameIndex + data.fullName.length, nameIndex + data.fullName.length + 300);
            log.info(`Text after name: ${textAfterName}`);
            
            // Look for bio-like text (not numbers)
            const bioMatch = textAfterName.match(/^\s*([^0-9]+?)(?=\d+\s*(?:posts|followers|following))/i);
            if (bioMatch && bioMatch[1]) {
                let extractedBio = bioMatch[1].trim();
                extractedBio = extractedBio.replace(/\s+/g, ' ');
                if (extractedBio.length > 10 && extractedBio.length < 300) {
                    data.bio = extractedBio;
                    log.info(`Extracted bio after name: ${data.bio}`);
                }
            }
        }
    }
    
    // Strategy 4: Extract stats from meta description first, then body text
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
    
    // Strategy 5: Extract stats from page body text (fallback)
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
    
    // Strategy 6: Check for verification
    data.isVerified = bodyText.toLowerCase().includes('verified') || 
                     $('[title*="verified" i], [alt*="verified" i]').length > 0 ||
                     $('body').html().toLowerCase().includes('verified');
    
    // Strategy 7: Extract website links (improved with debugging)
    log.info('Starting website extraction...');
    
    // First try to find common bio link services in body text
    const linkPatterns = [
        /(linktr\.ee\/[\w\.-]+)/gi,
        /(bio\.link\/[\w\.-]+)/gi,
        /(linkin\.bio\/[\w\.-]+)/gi,
        /(beacons\.ai\/[\w\.-]+)/gi,
        /(bit\.ly\/[\w\.-]+)/gi,
        /(tinyurl\.com\/[\w\.-]+)/gi
    ];
    
    for (const pattern of linkPatterns) {
        const matches = [...bodyText.matchAll(pattern)];
        if (matches.length > 0) {
            const foundLink = matches[0][1];
            data.website = foundLink.startsWith('http') ? foundLink : `https://${foundLink}`;
            log.info(`Found website via pattern: ${data.website}`);
            break;
        }
    }
    
    // Debug: Search for common website indicators
    const websiteIndicators = ['linktr.ee', 'bio.link', '.com', 'www.'];
    websiteIndicators.forEach(indicator => {
        if (bodyText.toLowerCase().includes(indicator)) {
            log.info(`Found website indicator "${indicator}" in body text`);
            const index = bodyText.toLowerCase().indexOf(indicator);
            const context = bodyText.substring(Math.max(0, index - 30), index + 50);
            log.info(`Context around "${indicator}": ${context}`);
        }
    });
    
    // Alternative: look for any links in href attributes
    if (!data.website) {
        log.info('Searching for links in href attributes...');
        $('a[href]').each((i, link) => {
            const href = $(link).attr('href');
            const linkText = $(link).text();
            log.info(`Found link: ${href} with text: ${linkText}`);
            
            if (href && 
                href.startsWith('http') && 
                !href.includes('instagram.com') && 
                !href.includes('facebook.com') &&
                !href.includes('google.com') &&
                !data.website) {
                data.website = href;
                log.info(`Selected website from href: ${data.website}`);
            }
        });
    }
    
    // Last resort: look for URL patterns in text
    if (!data.website) {
        log.info('Last resort: searching for URL patterns in text...');
        const urlPatterns = [
            /(https?:\/\/[^\s]+)/gi,
            /([a-zA-Z0-9-]+\.[a-zA-Z]{2,}\/[^\s]*)/gi
        ];
        
        for (const pattern of urlPatterns) {
            const matches = [...bodyText.matchAll(pattern)];
            for (const match of matches) {
                const foundUrl = match[1];
                if (!foundUrl.includes('instagram.com') && !foundUrl.includes('facebook.com')) {
                    data.website = foundUrl.startsWith('http') ? foundUrl : `https://${foundUrl}`;
                    log.info(`Found URL pattern: ${data.website}`);
                    break;
                }
            }
            if (data.website) break;
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