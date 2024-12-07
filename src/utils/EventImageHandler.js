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

    static async findTapologyEvent(eventName) {
        try {
            console.log('Finding event for:', eventName);
            
            // Handle different UFC event name formats
            let searchPath;
            
            // Check for numbered UFC event
            const numberedMatch = eventName.match(/UFC\s+(\d+)/i);
            if (numberedMatch) {
                searchPath = `ufc-${numberedMatch[1]}`;
            } 
            // Check for Fight Night format
            else if (eventName.toLowerCase().includes('fight night')) {
                const cleanName = eventName
                    .toLowerCase()
                    .replace('ufc fight night:', '')
                    .replace('ufc fight night', '')
                    .trim()
                    .replace(/\s+/g, '-')
                    .replace(/[^a-z0-9-]/g, '');
                
                searchPath = `ufc-fight-night-${cleanName}`;
            }
            // Handle any other UFC event format
            else if (eventName.toLowerCase().includes('ufc')) {
                const cleanName = eventName
                    .toLowerCase()
                    .replace('ufc', '')
                    .trim()
                    .replace(/\s+/g, '-')
                    .replace(/[^a-z0-9-]/g, '');
                    
                searchPath = `ufc-${cleanName}`;
            } else {
                console.log('Not a UFC event:', eventName);
                return null;
            }
    
            // Try different Tapology URL patterns
            const urls = [
                `${this.BASE_URL}/fightcenter/events/${searchPath}`,
                `${this.BASE_URL}/fightcenter/schedule/${searchPath}`,
                `${this.BASE_URL}/fightcenter/schedule/2024/${searchPath}`
            ];
    
            console.log('Trying URLs:', urls);
    
            for (const searchUrl of urls) {
                try {
                    const response = await axios.get(searchUrl, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/91.0.4472.124 Safari/537.36'
                        }
                    });
    
                    const $ = cheerio.load(response.data);
                    
                    // Updated selectors based on Tapology's current structure
                    const possibleSelectors = [
                        'img[alt="UFC 310"]',
                        'img[class*="max-h-52"]',
                        '.poster img',
                        '.event_card img',
                        '.main_event_images img',
                        '.details_head_poster img',
                        '.event_banner img',
                        'img.fight_card_poster',
                        '.event-details img',
                        '.fight-card-header img'
                    ];
    
                    for (const selector of possibleSelectors) {
                        const img = $(selector).first();
                        if (img.length) {
                            const imgSrc = img.attr('src');
                            if (imgSrc) {
                                console.log('Found image:', imgSrc);
                                return imgSrc.startsWith('http') ? imgSrc : `${this.BASE_URL}${imgSrc}`;
                            }
                        }
                    }
    
                    // Try finding by event name in image attributes
                    const allImages = $('img').filter((_, elem) => {
                        const src = $(elem).attr('src') || '';
                        const alt = $(elem).attr('alt') || '';
                        return (
                            src.toLowerCase().includes(searchPath) || 
                            alt.toLowerCase().includes(eventName.toLowerCase())
                        );
                    });
    
                    if (allImages.length > 0) {
                        const imgSrc = allImages.first().attr('src');
                        if (imgSrc) {
                            return imgSrc.startsWith('http') ? imgSrc : `${this.BASE_URL}${imgSrc}`;
                        }
                    }
                } catch (urlError) {
                    console.log('Error trying URL:', searchUrl, urlError.message);
                    continue;
                }
            }
    
            console.log('No image found for event:', eventName);
            return null;
        } catch (error) {
            console.error('Error finding event:', error);
            return null;
        }
    }

    static async getCachedImage(eventNumber) {
        const cacheFile = path.join(this.CACHE_DIR, `ufc-${eventNumber}.jpg`);
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

    static async saveToCache(imageData, eventNumber) {
        const cacheFile = path.join(this.CACHE_DIR, `ufc-${eventNumber}.jpg`);
        try {
            await fs.writeFile(cacheFile, imageData);
        } catch (error) {
            console.error('Error saving to cache:', error);
        }
    }

    static async getEventImage(event) {
        try {
            await this.ensureCacheDir();
    
            const eventNumber = event.Event.match(/UFC\s+(\d+)/i)?.[1];
            if (!eventNumber) {
                console.log('Could not extract event number from:', event.Event);
                return new AttachmentBuilder('./src/images/FightGenie_Logo_1.PNG', { 
                    name: 'FightGenie_Logo_1.PNG' 
                });
            }
    
            const cachedImage = await this.getCachedImage(eventNumber);
            if (cachedImage) {
                console.log('Using cached image for UFC', eventNumber);
                return new AttachmentBuilder(cachedImage, { 
                    name: `ufc-${eventNumber}.jpg`,
                    description: `UFC ${eventNumber} Event Poster`
                });
            }
    
            const imageUrl = await this.findTapologyEvent(event.Event);
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
                        // Minimal processing to maintain original format
                        const processedImage = await sharp(Buffer.from(response.data))
                            .jpeg({ quality: 90 })
                            .toBuffer();
    
                        await this.saveToCache(processedImage, eventNumber);
    
                        return new AttachmentBuilder(processedImage, { 
                            name: `ufc-${eventNumber}.jpg`
                        });
                    }
                } catch (imageError) {
                    console.error('Error processing image:', imageError);
                }
            }
    
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
        
    static async modifyEventEmbed(embed, event) {
        try {
            const imageAttachment = await this.getEventImage(event);
            const logoAttachment = new AttachmentBuilder('./src/images/FightGenie_Logo_1.PNG', { 
                name: 'FightGenie_Logo_1.PNG'
            });
    
            embed.setImage(`attachment://${imageAttachment.name}`)  // Set image before description
                .setThumbnail('attachment://FightGenie_Logo_1.PNG');
    
            return {
                embed,
                files: [imageAttachment, logoAttachment]
            };
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