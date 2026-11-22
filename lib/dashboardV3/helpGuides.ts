/**
 * "Watch how": what each helper actually shows. Until real recordings exist, every topic gets its own short, animated
 * walk-through: the steps in plain words, where each one happens and the exact button or box to use. Labels here match
 * the words on the real screens, so what someone reads is what they will see. Pure data.
 */
export type GuideStepKind = "button" | "field" | "tab" | "choice";
export type GuideStep = { text: string; where: string; target: string; kind: GuideStepKind };
export type Guide = { intro: string; steps: GuideStep[] };

const s = (kind: GuideStepKind, where: string, target: string, text: string): GuideStep => ({ kind, where, target, text });

const GUIDES: Record<string, Guide> = {
  // Home steps
  "Choosing a design": {
    intro: "You already picked a design. Here is how to change how it looks.",
    steps: [
      s("button", "Home", "Edit site", "Tap Edit site to open your site."),
      s("tab", "Your site", "Pages", "Open Pages and tap the page you want to change."),
      s("button", "Home", "Tell SOL what you want", "Or tell SOL the look you want, like “make it warmer and simpler”."),
    ],
  },
  "Adding your logo and colours": {
    intro: "Add your logo and pick your main colour so every page looks like you.",
    steps: [
      s("button", "Home", "Add logo and colours", "Tap Add logo and colours. It opens your Brand page."),
      s("button", "Brand", "Add your logo", "Upload your logo, or say you don't have one yet."),
      s("field", "Brand", "Main colour", "Choose your main colour."),
      s("button", "Brand", "Save", "Tap Save. This step ticks itself."),
    ],
  },
  "Adding your first product": {
    intro: "Add one product to start. You can add photos and more later.",
    steps: [
      s("field", "Home", "What are you selling?", "Type the name of what you sell."),
      s("field", "Home", "Price", "Type the price. Just the number."),
      s("button", "Home", "Add to my store", "Tap Add to my store."),
    ],
  },
  "Getting paid": {
    intro: "Choose how customers pay you. You can change it any time.",
    steps: [
      s("choice", "Home", "How do you want to get paid?", "Pick card payments or a bank transfer."),
      s("field", "Home", "Account number", "Fill in the details it asks for."),
      s("button", "Home", "Save how I get paid", "Tap Save how I get paid."),
    ],
  },
  "Finishing up": {
    intro: "Pick your web address and put your site online, all in one go.",
    steps: [
      s("field", "Home", "Your web address", "Type a short name, like your business name."),
      s("button", "Home", "Put my site online", "Tap Put my site online."),
      s("button", "Home", "Copy link", "Then tap Copy link and send it to your first customers."),
    ],
  },
  "Putting your app online": {
    intro: "Make your app available to everyone.",
    steps: [
      s("tab", "Your site", "App", "Open your app."),
      s("button", "App", "Put my app online", "Tap Put my app online when you are happy with it."),
    ],
  },
  "Editing the words on your site": {
    intro: "Read each page and fix anything that doesn't sound like you.",
    steps: [
      s("button", "Home", "Change the words", "Tap Change the words."),
      s("button", "Words", "Edit this page", "Tap Edit this page, click a piece of text and type your own."),
      s("button", "Words", "Looks good, next page", "Tap Looks good, next page, or Skip this page, until the end."),
    ],
  },
  "Adding contact details": {
    intro: "Put your phone, email and address where visitors can find them.",
    steps: [
      s("tab", "Your site", "Pages", "Open the Contact page."),
      s("field", "Editor", "Phone, email, address", "Click each detail and type yours."),
      s("button", "Editor", "Publish", "Tap Publish."),
    ],
  },
  "Adding your links": {
    intro: "Put every link you want people to find on your page.",
    steps: [
      s("tab", "Your site", "Pages", "Open your page."),
      s("button", "Editor", "A link button", "Click a button and paste the link you want it to open."),
      s("button", "Editor", "Publish", "Tap Publish."),
    ],
  },
  "Writing your first post": {
    intro: "A few lines is enough to start.",
    steps: [
      s("tab", "Your site", "Blog", "Open the Blog tab."),
      s("button", "Blog", "Write a post", "Tap Write a post, add a title and some words."),
      s("button", "Blog", "Publish", "Tap Publish. Or ask SOL to draft it for you."),
    ],
  },
  "Adding your first lesson": {
    intro: "A video, some words, or both.",
    steps: [
      s("tab", "Your site", "Course", "Open the Course tab."),
      s("button", "Course", "Add a lesson", "Tap Add a lesson."),
      s("field", "Course", "Lesson title", "Name it and add your video or words, then save."),
    ],
  },
  "Setting your course price": {
    intro: "Decide what people pay to join, or make it free.",
    steps: [
      s("tab", "Your site", "Course", "Open the Course tab."),
      s("tab", "Course", "Price and sign-up", "Open Price and sign-up."),
      s("button", "Course", "Save", "Type a price, or choose free, and save."),
    ],
  },
  "Describing your app": {
    intro: "Tell SOL what your app should do, in your own words.",
    steps: [
      s("button", "Home", "Tell SOL what you want", "Tap Tell SOL what you want."),
      s("field", "SOL", "Ask SOL", "Describe the app: who uses it and what they can do."),
      s("button", "SOL", "Send", "Send it. SOL builds it and asks before guessing."),
    ],
  },
  "Turning on sign-in": {
    intro: "So people can make an account and come back.",
    steps: [
      s("tab", "Your site", "App", "Open the App tab."),
      s("choice", "App", "Sign-in", "Switch sign-in on."),
    ],
  },
  "How these steps work": {
    intro: "Each step finishes right on the page. Do them in order.",
    steps: [
      s("button", "Home", "The open step", "The open step has what you need. Do it right there."),
      s("choice", "Home", "A tick", "When it is done it gets a tick and the next one opens."),
      s("button", "Home", "Tell SOL what you want", "Stuck? Ask SOL to do a step for you."),
    ],
  },
  // Site hub tabs
  "How to add and change pages": {
    intro: "Every page of your site is here.",
    steps: [
      s("button", "Pages", "Add a page", "Tap Add a page, pick a start and give it a name."),
      s("button", "Pages", "A page card", "Tap any page to change it."),
      s("button", "Pages", "Manage pages", "Use Manage pages to reorder or remove pages."),
    ],
  },
  "How to add a product": {
    intro: "Products appear in your shop as soon as you save them.",
    steps: [
      s("tab", "Your site", "Products", "Open the Products tab."),
      s("button", "Products", "Add a product", "Tap Add a product, then fill in the name and price."),
      s("button", "Products", "Save", "Add photos if you like, then save."),
    ],
  },
  "How to handle an order": {
    intro: "New orders show here with everything you need.",
    steps: [
      s("tab", "Your site", "Orders", "Open the Orders tab."),
      s("button", "Orders", "An order", "Tap an order to see who bought what."),
      s("choice", "Orders", "Status", "Update it when you have sent or delivered it."),
    ],
  },
  "How to write a blog post": {
    intro: "Share news and stories on your site.",
    steps: [
      s("tab", "Your site", "Blog", "Open the Blog tab."),
      s("button", "Blog", "Write a post", "Tap Write a post and add a title and your words."),
      s("button", "Blog", "Publish", "Tap Publish."),
    ],
  },
  "How to add a lesson": {
    intro: "Lessons are what people see once they have joined.",
    steps: [
      s("tab", "Your site", "Course", "Open the Course tab."),
      s("button", "Course", "Add a lesson", "Tap Add a lesson."),
      s("button", "Course", "Save", "Add your video or words, then save."),
    ],
  },
  "How to change your colours and logo": {
    intro: "Change how your site looks everywhere at once.",
    steps: [
      s("tab", "Your site", "Brand", "Open the Brand tab."),
      s("button", "Brand", "Add your logo", "Upload a new logo."),
      s("field", "Brand", "Main colour", "Pick your colour, then Save."),
    ],
  },
  "How to choose your web address": {
    intro: "The link people use to reach your site.",
    steps: [
      s("tab", "Your site", "Web address", "Open the Web address tab."),
      s("field", "Web address", "Your web address", "Type the name you want."),
      s("button", "Web address", "Use this address", "Tap Use this address."),
    ],
  },
  "How to read your visits": {
    intro: "See how many people visit and where they come from.",
    steps: [
      s("tab", "Your site", "Visits", "Open the Visits tab."),
      s("choice", "Visits", "Time range", "Choose the time you want to look at."),
    ],
  },
  "How to change your site's settings": {
    intro: "Rename your site and manage the extras.",
    steps: [
      s("tab", "Your site", "Settings", "Open the Settings tab."),
      s("field", "Settings", "Site name", "Change the name and tap Save."),
    ],
  },
  "How to update your app": {
    intro: "Ask SOL for changes and put them online.",
    steps: [
      s("tab", "Your site", "App", "Open the App tab."),
      s("button", "App", "Ask SOL to change it", "Describe the change you want."),
      s("button", "App", "Put my app online", "Put the new version online when you like it."),
    ],
  },
};

/** The guide for a topic title, or a calm generic one when a topic has none yet. */
export function guideFor(title: string): Guide {
  return (
    GUIDES[title] ?? {
      intro: "Here is the idea.",
      steps: [
        s("button", "Your dashboard", "The button on this step", "Use the button on the step you are on."),
        s("button", "Your dashboard", "Tell SOL what you want", "Or ask SOL to do it for you."),
      ],
    }
  );
}

export const GUIDE_TITLES = Object.keys(GUIDES);
