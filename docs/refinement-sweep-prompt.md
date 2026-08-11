# Bug fix and refinement sweep

Before we start on Phase 3 of the transmutes updates, let's fix some issues and refine what we already have. Do not push any changes or open a PR until I have signed off on all these fixes. These are refinement steps so I want to be involved directly.

## Cross site items

### View toggle on mobile
On the Prices and Transmutes page, the View toggle box stretches to fill width of the page. On other pages, the view toggle conforms to text. 

I like the full width box. Let's make that a consistent standard for all pages across the site.

This will also fix an issue on the Anaylitcs page where the Group by Auction text is clipped in the View toggle. 

### Mobile page navigation - dropdown vs. tabs/links
We recently decreased the number of top-level pages from 8 to 5. We originally went with a dropdown menu on mobile because 8 links caused wrapping or horizontal scroll. 

Now that we have 5 pages instead of 8, let's experiment with tabs/links on mobile again, just like desktop. Test this to see if it can all fit on a single line. Shorten Auction Data -> Data if necessary. Do not code unless it is tested to fit properly. Pause before you code

## Transmutes - Recipe calculator

### Recipes calculator Number entry on mobile - Cursor placed before default 0
When you tap to edit a quantity or value on Mobile, the cursor can be positioned at the start of the entry box, before the default 0. Is there a way to either clear the existing text on entry? The issue to solve is that you can accidentally type a multiple of 10 when you meant to enter a single digit. For example, typing 2 could make it 20.

It is acceptable for the fix to affect Desktop as well.

### Recipe calculator Mobile entry - navigate between fields
On some fields/forms on my iPhone, I see arrows when I'm in a field to move to the next or previous entry field. I think this is built in iOS functionality. How do we get this enabled? Does Android do something similar?

### Recipe Mobile calculator number entry - no spinner
Unlike desktop, there is no spinner on mobile to tap to increase/decrease the quantity. Suggest a fix for this. Should mobile have spinners as well? Dedicated - and + buttons on mobile only? 

### Recipe calculator - buttons don't read as buttons
The buttons on the recipe calculator don't immediately jump out as buttons you can click. Enhance the buttons so they are easier to discern from the background.


## Analyitcs page

### Current year view
Move the Season control to its own line so that the site-wide View toggle change has room

### Quartiles view
Add a heading that says "Quartiles" above the intro text. Change the Year label to Season to remain consistent. 
