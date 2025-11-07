const axios = require('axios');
const cheerio = require('cheerio');

async function scrapeWalkerEvent() {
  try {
    console.log("=== SCRAPING WALKER VS ZHANG EVENT ===\n");
    
    // The event link from the database
    const eventLink = 'http://www.ufcstats.com/event-details/754968e325d6f60d';
    
    console.log(`Fetching fights from: ${eventLink}`);
    
    const response = await axios.get(eventLink);
    const $ = cheerio.load(response.data);
    
    console.log("Page title:", $('title').text());
    
    // Try different selectors to find fights
    console.log("\n=== TRYING DIFFERENT SELECTORS ===");
    
    // Selector 1: Standard fight table rows
    console.log("\n1. Standard fight table rows (.b-fight-details__table-row):");
    let fightCount = 0;
    $('.b-fight-details__table-row').each((idx, row) => {
      const $row = $(row);
      
      // Get both fighters from the table cells
      const fighters = $row.find('.b-link.b-link_style_black')
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(name => name && !name.includes('View') && !name.includes('Matchup'));
      
      // Get weight class
      const weightClass = $row.find('.b-fight-details__table-text')
        .filter((_, el) => {
          const text = $(el).text().trim();
          return text.includes('weight') || text.includes('Weight');
        })
        .first()
        .text()
        .trim();
      
      if (fighters.length === 2) {
        fightCount++;
        console.log(`Fight ${fightCount}: ${fighters[0]} vs ${fighters[1]} (${weightClass || 'TBD'}) - Main Card: ${idx < 5 ? 'Yes' : 'No'}`);
      }
    });
    
    if (fightCount === 0) {
      console.log("No fights found with standard selector");
      
      // Selector 2: Try tbody tr
      console.log("\n2. Trying tbody tr:");
      $('tbody tr').each((idx, row) => {
        const $row = $(row);
        const fighters = $row.find('a')
          .map((_, el) => $(el).text().trim())
          .get()
          .filter(name => name && !name.includes('View') && !name.includes('Matchup'));
        
        if (fighters.length >= 2) {
          fightCount++;
          console.log(`Fight ${fightCount}: ${fighters[0]} vs ${fighters[1]} - Row ${idx}`);
        }
      });
    }
    
    if (fightCount === 0) {
      console.log("No fights found with tbody tr selector either");
      
      // Selector 3: Try any links that might be fighter names
      console.log("\n3. All links on the page:");
      const allLinks = $('a').map((_, el) => $(el).text().trim()).get()
        .filter(text => text && text.length > 2 && !text.includes('View') && !text.includes('UFC') && !text.includes('http'));
      
      console.log("Potential fighter names found:", allLinks.slice(0, 20)); // Show first 20
    }
    
    // Check if this is an upcoming event page structure
    console.log("\n4. Checking for upcoming event structure:");
    const upcomingFights = $('.c-listing-fight__content');
    console.log(`Found ${upcomingFights.length} upcoming fight elements`);
    
    upcomingFights.each((idx, fightEl) => {
      const $fight = $(fightEl);
      const fighter1 = $fight.find('.c-listing-fight__corner-name--red').text().trim();
      const fighter2 = $fight.find('.c-listing-fight__corner-name--blue').text().trim();
      const weightClass = $fight.find('.c-listing-fight__class-text').text().trim();
      
      if (fighter1 && fighter2) {
        console.log(`Upcoming Fight ${idx + 1}: ${fighter1} vs ${fighter2} (${weightClass})`);
      }
    });
    
    console.log(`\nTotal fights found: ${fightCount}`);
    
  } catch (error) {
    console.error("Error scraping event:", error.message);
  }
}

scrapeWalkerEvent();
