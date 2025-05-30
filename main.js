const Apify = require('apify');
const cheerio = require('cheerio');

Apify.main(async () => {
    const input = await Apify.getInput();
    const { urls = [] } = input;

    const requestQueue = await Apify.openRequestQueue();
    for (const url of urls) {
        await requestQueue.addRequest({ url });
    }

    const crawler = new Apify.CheerioCrawler({
        requestQueue,
        useSessionPool: true,
        persistCookiesPerSession: true,
        maxConcurrency: 10,
        handlePageTimeoutSecs: 60,
        maxRequestRetries: 3,
        proxyConfiguration: await Apify.createProxyConfiguration({
            useApifyProxy: true,
        }),

        handlePageFunction: async ({ request, $, body }) => {
            const data = {};

            // Try parsing JSON-LD structured data
            const jsonLdScript = $('script[type="application/ld+json"]').html();
            if (jsonLdScript) {
                try {
                    const jsonData = JSON.parse(jsonLdScript);
                    data.name = jsonData.name;
                    data.url = jsonData.url;
                    data.image = jsonData.image;
                    data.description = jsonData.description;
                } catch (e) {
                    Apify.utils.log.warning(`Failed to parse JSON-LD on ${request.url}`);
                }
            }

            // Fallback: extract from window._sharedData
            const sharedData = extractSharedData($);
            if (sharedData) {
                try {
                    const user = sharedData?.entry_data?.ProfilePage?.[0]?.graphql?.user;
                    if (user) {
                        data.username = user.username;
                        data.fullName = user.full_name;
                        data.followerCount = user.edge_followed_by?.count;
                        data.followingCount = user.edge_follow?.count;
                        data.postsCount = user.edge_owner_to_timeline_media?.count;
                        data.isVerified = user.is_verified;
                        data.isPrivate = user.is_private;
                        data.bio = user.biography || data.description || null;
                    }
                } catch (err) {
                    Apify.utils.log.warning(`Error parsing sharedData on ${request.url}`);
                }
            }

            await Apify.pushData(data);
        },

        handleFailedRequestFunction: async ({ request }) => {
            Apify.utils.log.error(`Request failed: ${request.url}`);
        },
    });

    await crawler.run();
});

function extractSharedData($) {
    const scriptTags = $('script');
    for (let i = 0; i < scriptTags.length; i++) {
        const html = $(scriptTags[i]).html();
        if (html.includes('window._sharedData')) {
            try {
                const match = html.match(/window\._sharedData\s*=\s*(\{.*\});/);
                if (match && match[1]) {
                    return JSON.parse(match[1]);
                }
            } catch (err) {
                Apify.utils.log.warning('Failed to parse window._sharedData');
            }
        }
    }
    return null;
}
