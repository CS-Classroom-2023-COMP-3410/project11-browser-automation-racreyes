const puppeteer = require('puppeteer');
const fs = require('fs');
const axios = require('axios');
const readline = require('readline');

/**
 * Helper to prompt user input from the terminal.
 */
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise(resolve =>
    rl.question(query, ans => {
      rl.close();
      resolve(ans);
    })
  );
}

(async () => {
  // Load credentials from credentials.json.
  // Example structure:
  // {
  //   "username": "YOUR_USERNAME",
  //   "password": "YOUR_PASSWORD",
  //   "token": "YOUR_PERSONAL_ACCESS_TOKEN"
  // }
  const credentials = JSON.parse(fs.readFileSync('credentials.json', 'utf8'));
  const username = credentials.username;
  const password = credentials.password;
  const token = credentials.token;

  // List of repositories to star.
  const repositories = [
    'cheeriojs/cheerio',
    'axios/axios',
    'puppeteer/puppeteer'
  ];

  // Launch browser in headless mode with the specified args.
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--disable-features=site-per-process',
      '--remote-debugging-port=9222'
    ]
  });
  const page = await browser.newPage();

  // ---------------------------
  // Step 1: Log in via UI.
  // ---------------------------
  console.log('Navigating to GitHub login page...');
  await page.goto('https://github.com/login', { waitUntil: 'networkidle2' });

  console.log('Filling in username and password...');
  await page.type('#login_field', username, { delay: 50 });
  await page.type('#password', password, { delay: 50 });
  await Promise.all([
    page.click('[name="commit"]'),
    page.waitForNavigation({ waitUntil: 'networkidle2' })
  ]);

  // Handle 2FA if present.
  const otpSelector = 'input[name="otp"]';
  if (await page.$(otpSelector) !== null) {
    console.log('Two-Factor Authentication detected.');
    const otpCode = await askQuestion('Enter your 2FA code: ');
    await page.type(otpSelector, otpCode, { delay: 50 });
    await Promise.all([
      page.click('[type="submit"]'),
      page.waitForNavigation({ waitUntil: 'networkidle2' })
    ]);
  }
  console.log('Logged in successfully via UI.');

  // ---------------------------
  // Step 2: Star repositories via API.
  // ---------------------------
  console.log('Starring repositories via GitHub API...');
  const apiHeaders = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'PuppeteerBot'
  };

  for (const repo of repositories) {
    try {
      await axios.put(`https://api.github.com/user/starred/${repo}`, {}, { headers: apiHeaders });
      console.log(`⭐ Starred: ${repo}`);
    } catch (error) {
      console.error(`❌ Failed to star ${repo}:`, error.response ? error.response.data : error.message);
    }
  }

  // ---------------------------
  // Step 3: Create a starred list ("Node Libraries") via UI.
  // ---------------------------
  console.log('Navigating to GitHub Stars page...');
  await page.goto(`https://github.com/${username}?tab=stars`, { waitUntil: 'networkidle2' });

  // Use a CSS selector to locate the "Create list" button.
  // This selector targets a <summary> element with classes "btn-primary btn"
  // that is inside a <details> element with class "js-follow-list".
  const createListButtonSelector = 'details.js-follow-list summary.btn-primary.btn';
  try {
    await page.waitForSelector(createListButtonSelector, { timeout: 10000 });
  } catch (err) {
    console.error("❌ 'Create list' button not found within timeout.");
    await browser.close();
    process.exit(1);
  }
  const createListButton = await page.$(createListButtonSelector);
  if (createListButton) {
    await createListButton.click();
    console.log("📂 Clicked the 'Create list' button.");
  } else {
    console.error("❌ 'Create list' button not found after waiting.");
    await browser.close();
    process.exit(1);
  }

  // Wait for the <details> element to have the open attribute.
  try {
    await page.waitForFunction(() => {
      const details = document.querySelector('details.js-follow-list');
      return details && details.hasAttribute('open');
    }, { timeout: 10000 });
    console.log('✅ The "Create list" modal is now open.');
  } catch (err) {
    console.error('❌ Timeout waiting for the modal to open:', err);
    await browser.close();
    process.exit(1);
  }

  // Wait for the modal dialog to appear.
  const modalSelector = 'details-dialog[aria-label="Create list"]';
  try {
    await page.waitForSelector(modalSelector, { timeout: 10000 });
    console.log("✅ Create list modal detected.");
  } catch (err) {
    console.error("❌ Create list modal not detected:", err);
    await browser.close();
    process.exit(1);
  }

  // Fill in the list name.
  const listNameInputSelector = `${modalSelector} input[name="user_list[name]"]`;
  await page.waitForSelector(listNameInputSelector, { timeout: 5000 });
  await page.type(listNameInputSelector, "Node Libraries", { delay: 100 });

  // Optionally, fill in a description.
  const listDescriptionSelector = `${modalSelector} textarea[name="user_list[description]"]`;
  await page.waitForSelector(listDescriptionSelector, { timeout: 5000 });
  await page.type(listDescriptionSelector, "A list for Node Libraries", { delay: 100 });

  // Wait for the "Create" button to become enabled.
  const createButtonSelector = `${modalSelector} button[type="submit"]:not([disabled])`;
  await page.waitForSelector(createButtonSelector, { timeout: 5000 });
  await page.click(createButtonSelector);
  console.log("✅ Clicked the 'Create' button to create the list.");

  // Wait briefly for GitHub to process the request.
  await page.waitForTimeout(3000);
  console.log("✅ Automation complete.");

  await browser.close();
})();
