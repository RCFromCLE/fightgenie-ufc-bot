const axios = require('axios');
const sharp = require('sharp');
const { AttachmentBuilder } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');
const cheerio = require('cheerio');

class EventImageHandler {
    static CACHE_DIR = path.join(process.cwd(), 'cache', 'event-images');
    static CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
    static BASE_URL = 'https://www.tapology.com';

    static async ensureCacheDir() {
        try {
            await fs.mkdir(this.CACHE_DIR, { recursive: true });
        } catch (error) {
            console.error('Cache directory creation error:', error);
        }
    }

    static async findTapologyEvent(event) {
        try {
            if (!event || typeof event !== 'object') {
                console.log('Invalid event object received:', event);
                return null;
            }

            console.log('Finding event:', event);
            
            // Safely extract and validate the date
            let formattedDate = '';
            if (event.Date) {
                try {
                    const eventDate = new Date(event.Date);
                    if (!isNaN(eventDate.getTime())) {  // Check if date is valid
                        formattedDate = eventDate.toLocaleDateString('en-US', { 
                            month: 'numeric', 
                            day: 'numeric', 
                            year: 'numeric' 
                        });
                        console.log('Looking for event on:', formattedDate);
                    } else {
                        console.log('Invalid date format:', event.Date);
                    }
                } catch (dateError) {
                    console.error('Error parsing date:', dateError);
                }
            }

            // Get base event name if it exists
            const eventName = event.Event || '';
            if (!eventName) {
                console.log('No event name found in event object');
                return null;
            }

            // Fetch the Tapology homepage
            console.log('Fetching Tapology homepage...');
            const homeResponse = await axios.get(this.BASE_URL, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });

            const $ = cheerio.load(homeResponse.data);
            let eventLink = null;

            // Search for the event link in the homepage content
            console.log('Searching for event:', eventName);
            $('a').each((_, elem) => {
                const href = $(elem).attr('href');
                const text = $(elem).text();
                
                // Skip invalid elements
                if (!href || !text) return;
                
                // Convert to lowercase for comparison
                const textLower = text.toLowerCase();
                const eventNameLower = eventName.toLowerCase();
                
                if (href && textLower.includes('ufc') && textLower.includes(eventNameLower)) {
                    console.log('Found matching event link:', href);
                    eventLink = href;
                    return false; // Break the loop
                }
            });

            if (!eventLink) {
                console.log('No event link found for:', eventName);
                return null;
            }

            // Complete the URL if it's relative
            const eventUrl = eventLink.startsWith('http') ? eventLink : `${this.BASE_URL}${eventLink}`;
            console.log('Accessing event page:', eventUrl);

            // Fetch the event page
            const eventResponse = await axios.get(eventUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });

            const eventPage = cheerio.load(eventResponse.data);
            
            // Look for the event poster
            console.log('Searching for poster image...');
            const posterSelectors = [
                'img[src*="fight-poster"]',
                'img[src*="event-poster"]',
                '.fight_card_poster img',
                '.event_poster img',
                'img.poster_img',
                '.poster img',
                '#poster_image img',
                'img[src*="poster"]'
            ];

            for (const selector of posterSelectors) {
                const posterImg = eventPage(selector).first();
                if (posterImg.length) {
                    const imgSrc = posterImg.attr('src');
                    if (imgSrc && !imgSrc.includes('missing') && !imgSrc.includes('loader')) {
                        console.log('Found poster image:', imgSrc);
                        return imgSrc.startsWith('http') ? imgSrc : `${this.BASE_URL}${imgSrc}`;
                    }
                }
            }

            // If no poster found, try to find any UFC-related image
            console.log('No poster found, looking for any UFC-related image...');
            const ufcImage = eventPage('img[src*="ufc"]').first();
            if (ufcImage.length) {
                const imgSrc = ufcImage.attr('src');
                if (imgSrc && !imgSrc.includes('missing') && !imgSrc.includes('loader')) {
                    console.log('Found UFC image:', imgSrc);
                    return imgSrc.startsWith('http') ? imgSrc : `${this.BASE_URL}${imgSrc}`;
                }
            }

            console.log('No suitable image found for event:', eventName);
            return null;

        } catch (error) {
            console.error('Error in findTapologyEvent:', error);
            return null;
        }
    }

static async getEventImage(event) {
        try {
            await this.ensureCacheDir();
    
            // Generate a cache key based on event name
            let cacheKey;
            const numberedMatch = event.Event.match(/UFC\s+(\d+)/i);
            const fightNightMatch = event.Event.match(/UFC Fight Night:\s*(.+)/i);
            
            if (numberedMatch) {
                cacheKey = `ufc-${numberedMatch[1]}`;
            } else if (fightNightMatch) {
                // Clean the fighter names for the cache key
                const cleanNames = fightNightMatch[1]
                    .toLowerCase()
                    .replace(/\s+vs\.?\s+/, '-vs-')
                    .replace(/[^a-z0-9-]/g, '')
                    .trim();
                cacheKey = `fight-night-${cleanNames}`;
            } else {
                // Fallback for other event formats
                cacheKey = event.Event
                    .toLowerCase()
                    .replace(/\s+/g, '-')
                    .replace(/[^a-z0-9-]/g, '')
                    .trim();
            }

            console.log('Using cache key:', cacheKey);
    
            const cachedImage = await this.getCachedImage(cacheKey);
            if (cachedImage) {
                console.log('Using cached image for', cacheKey);
                return new AttachmentBuilder(cachedImage, { 
                    name: `${cacheKey}.jpg`,
                    description: `${event.Event} Event Poster`
                });
            }
    
            // Pass the full event object here instead of just event.Event
            const imageUrl = await this.findTapologyEvent(event);
            if (imageUrl) {
                console.log('Found Tapology image:', imageUrl);
                
                try {
                    const response = await axios.get(imageUrl, {
                        responseType: 'arraybuffer',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
                            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                            'Referer': 'https://www.tapology.com/',
                            'sec-fetch-dest': 'image',
                            'sec-fetch-mode': 'no-cors',
                            'sec-fetch-site': 'same-site'
                        },
                        maxRedirects: 5,
                        timeout: 10000
                    });
    
                    if (response.data) {
                        const processedImage = await sharp(Buffer.from(response.data))
                            .jpeg({ quality: 90 })
                            .toBuffer();
    
                        await this.saveToCache(processedImage, cacheKey);
    
                        return new AttachmentBuilder(processedImage, { 
                            name: `${cacheKey}.jpg`
                        });
                    }
                } catch (imageError) {
                    console.error('Error processing image:', imageError);
                }
            }
    
            console.log('Falling back to logo for event:', event.Event);
            return new AttachmentBuilder('./src/images/FightGenie_Logo_1.PNG', { 
                name: 'FightGenie_Logo_1.PNG' 
            });
    
        } catch (error) {
            console.error('Error in getEventImage:', error);
            return new AttachmentBuilder('./src/images/FightGenie_Logo_1.PNG', { 
                name: 'FightGenie_Logo_1.PNG' 
            });
        }
    }
    
    // Also update the getCachedImage method to handle string-based keys
    static async getCachedImage(cacheKey) {
        const cacheFile = path.join(this.CACHE_DIR, `${cacheKey}.jpg`);
        try {
            const stats = await fs.stat(cacheFile);
            if (Date.now() - stats.mtime.getTime() < this.CACHE_DURATION) {
                const data = await fs.readFile(cacheFile);
                return data;
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    // Update saveToCache to handle string-based keys
    static async saveToCache(imageData, cacheKey) {
        const cacheFile = path.join(this.CACHE_DIR, `${cacheKey}.jpg`);
        try {
            await fs.writeFile(cacheFile, imageData);
        } catch (error) {
            console.error('Error saving to cache:', error);
        }
    }
    
    
    static async modifyEventEmbed(embed, event) {
        try {
            const imageAttachment = await this.getEventImage(event);
            const logoAttachment = new AttachmentBuilder('./src/images/FightGenie_Logo_1.PNG', { 
                name: 'FightGenie_Logo_1.PNG'
            });
    
            // If we got an event image that's not the logo
            if (imageAttachment.name !== 'FightGenie_Logo_1.PNG') {
                embed
                    .setImage(`attachment://${imageAttachment.name}`)
                    .setThumbnail('attachment://FightGenie_Logo_1.PNG');
                
                return {
                    embed,
                    files: [imageAttachment, logoAttachment]
                };
            } else {
                // If we only have the logo, just use it as thumbnail
                embed.setThumbnail('attachment://FightGenie_Logo_1.PNG');
                
                return {
                    embed,
                    files: [logoAttachment]
                };
            }
        } catch (error) {
            console.error('Error modifying embed:', error);
            const fallbackAttachment = new AttachmentBuilder(
                './src/images/FightGenie_Logo_1.PNG',
                { name: 'FightGenie_Logo_1.PNG' }
            );
            
            embed.setThumbnail('attachment://FightGenie_Logo_1.PNG');
            
            return {
                embed,
                files: [fallbackAttachment]
            };
        }
    }

    static async clearCache() {
        try {
            const files = await fs.readdir(this.CACHE_DIR);
            const now = Date.now();

            for (const file of files) {
                const filePath = path.join(this.CACHE_DIR, file);
                const stats = await fs.stat(filePath);

                if (now - stats.mtime.getTime() > this.CACHE_DURATION) {
                    await fs.unlink(filePath);
                }
            }
        } catch (error) {
            console.error('Error clearing image cache:', error);
        }
    }
}

module.exports = EventImageHandler;