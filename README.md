# Instagram Profile Scraper

A robust and efficient Instagram profile scraper built for the Apify platform. This Actor extracts comprehensive profile information from Instagram accounts including user details, statistics, and optionally recent posts.

## 🚀 Features

- **Profile Information**: Username, full name, bio, profile image
- **Statistics**: Follower count, following count, posts count
- **Verification Status**: Detects verified accounts
- **Website Links**: Extracts linked websites from profiles
- **Recent Posts**: Optionally scrapes recent post URLs and images
- **Proxy Support**: Built-in Apify Proxy integration for IP rotation
- **Anti-Detection**: Smart delays and human-like behavior patterns
- **Robust Error Handling**: Comprehensive retry logic and error reporting

## 📋 Input Configuration

### Required Fields

- **Profile URLs**: List of Instagram profile URLs to scrape
  - Format: `https://www.instagram.com/username/`
  - Supports both individual URLs and bulk imports

### Optional Configuration

- **Proxy Settings**: Configure proxy usage (Apify Proxy recommended)
- **Recent Posts**: Enable/disable recent post scraping
- **Maximum Posts**: Limit number of posts to scrape per profile (1-50)
- **Retry Settings**: Configure maximum retry attempts (0-10)
- **Request Delay**: Set delay between requests in milliseconds (1000-10000)
- **Output Format**: Select which data fields to include in results

## 📊 Output Data

The scraper returns the following data for each profile:

```json
{
  "username": "example_user",
  "fullName": "Example User",
  "bio": "This is an example bio with emojis 🎉",
  "profileImage": "https://instagram.com/profile_image.jpg",
  "followers": 1500000,
  "following": 250,
  "postsCount": 847,
  "website": "https://example.com",
  "isVerified": true,
  "recentPosts": [
    {
      "url": "https://instagram.com/p/post_id/",
      "imageUrl": "https://instagram.com/post_image.jpg",
      "altText": "Post description"
    }
  ],
  "profileUrl": "https://www.instagram.com/example_user/",
  "scrapedAt": "2025-05-30T10:00:00.000Z"
}
```

## 🛠️ Usage Examples

### Basic Profile Scraping

```json
{
  "profileUrls": [
    {"url": "https://www.instagram.com/natgeo/"},
    {"url": "https://www.instagram.com/instagram/"}
  ],
  "proxy": {
    "useApifyProxy": true
  }
}
```

### Advanced Configuration with Recent Posts

```json
{
  "profileUrls": [
    {"url": "https://www.instagram.com/natgeo/"}
  ],
  "proxy": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  },
  "includeRecentPosts": true,
  "maxPostsToScrape": 20,
  "delay": 3000,
  "maxRetries": 5
}
```

## ⚙️ Best Practices

### Rate Limiting
- Use delays of at least 2000ms between requests
- Enable Apify Proxy for better success rates
- Limit concurrent requests to avoid overwhelming Instagram's servers

### Proxy Configuration
- **Residential Proxies**: Best success rate, recommended for production
- **Datacenter Proxies**: Faster but higher chance of blocks
- **Automatic Rotation**: Let Apify handle IP rotation automatically

### Error Handling
- The scraper automatically retries failed requests
- Failed profiles are logged with error details
- Use the dataset to identify and debug issues

## 🔧 Technical Details

### Dependencies
- **Apify SDK**: Platform integration and data handling
- **Crawlee**: Web scraping framework with Puppeteer
- **Puppeteer**: Headless Chrome automation

### Architecture
- Built on Apify's Actor platform
- Uses Puppeteer for reliable browser automation
- Implements smart retry logic and error recovery
- Includes comprehensive logging and monitoring

### Performance
- **Memory Usage**: ~1GB recommended
- **Execution Time**: ~2-5 seconds per profile
- **Concurrency**: Configurable based on requirements
- **Scaling**: Automatically scales on Apify platform

## 🚨 Important Notes

### Legal and Ethical Considerations
- Only scrape public profiles that are accessible without login
- Respect Instagram's terms of service and robots.txt
- Use reasonable delays to avoid overwhelming their servers
- Consider implementing additional respect measures for high-volume scraping

### Limitations
- Cannot access private profiles
- Some data may be unavailable due to Instagram's anti-scraping measures
- Success rates may vary based on account popularity and Instagram's current policies

### Troubleshooting
- **High Failure Rates**: Increase delays, enable residential proxies
- **Missing Data**: Some profiles may have restricted data access
- **Timeout Errors**: Increase timeout settings or reduce concurrency

## 📈 Performance Optimization

### For High-Volume Scraping
1. Use residential proxies exclusively
2. Implement longer delays (3-5 seconds)
3. Run during off-peak hours
4. Split large batches into smaller runs
5. Monitor success rates and adjust accordingly

### Memory Management
- The Actor is optimized for 1GB memory allocation
- For larger batches, consider running multiple smaller instances
- Monitor memory usage in Apify Console

## 🆕 Updates and Maintenance

This scraper is designed to be maintainable and adaptable to Instagram's changing structure. Regular updates may be needed to:

- Adapt to new Instagram layouts
- Update selector strategies
- Improve anti-detection measures
- Add new data extraction capabilities

## 📞 Support

For issues, questions, or feature requests:
1. Check the Apify Console logs for detailed error information
2. Verify your input configuration matches the schema
3. Test with a small batch first before scaling up
4. Review Instagram's current policies and limitations

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.