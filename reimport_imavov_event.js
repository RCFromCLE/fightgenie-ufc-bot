const AdminEventCommand = require('./src/commands/AdminEventCommand');

(async () => {
  try {
    const event = {
      name: 'UFC Fight Night: Imavov vs. Borralho',
      date: 'September 6, 2025',
      location: 'Paris, Ile-de-France, France',
      link: 'http://www.ufcstats.com/event-details/6e380a4d73ab4f0e'
    };

    console.log('Re-importing event:', event);
    await AdminEventCommand.storeNewEvent(event);
    console.log('✅ Re-import complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Re-import failed:', err);
    process.exit(1);
  }
})();
