import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, "../output/playwright");
const configuredBaseUrl = process.env.MOBILE_AUDIT_BASE_URL;
const auditPort = process.env.MOBILE_AUDIT_PORT ?? "3100";
const baseUrl = configuredBaseUrl ?? `http://127.0.0.1:${auditPort}`;

const viewports = [
  { name: "iphone-se", width: 320, height: 667 },
  { name: "375x667", width: 375, height: 667 },
  { name: "iphone-12", width: 390, height: 844 },
  { name: "iphone-14-pro-max", width: 430, height: 932 },
  { name: "tablet", width: 768, height: 1024 },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function canReach(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(900) });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function startDevServer() {
  const url = new URL(baseUrl);
  const child = spawn("npm", ["run", "dev", "--", "--hostname", url.hostname, "--port", url.port, "--webpack"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  for (let index = 0; index < 80; index += 1) {
    if (await canReach(baseUrl)) return child;
    if (child.exitCode !== null) {
      throw new Error(`Next dev server exited early.\n${output}`);
    }
    await wait(250);
  }

  child.kill();
  throw new Error(`Timed out waiting for ${baseUrl}.\n${output}`);
}

function route(pathname) {
  return new URL(pathname, baseUrl).toString();
}

async function hideDevTools(page) {
  await page.addStyleTag({
    content: `
      nextjs-portal,
      [data-nextjs-toast],
      [data-nextjs-dialog-overlay],
      [data-nextjs-dialog] {
        display: none !important;
      }
    `,
  });
}

async function auditPage(page, scenario, viewport) {
  await page.waitForLoadState("networkidle");
  await wait(150);

  const result = await page.evaluate(() => {
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body?.scrollWidth ?? 0,
    );
    const overflow = documentWidth > window.innerWidth + 1;
    const touchTargetSelector = [
      "button",
      "a",
      "input:not([type='hidden'])",
      "textarea",
      "select",
      "[role='button']",
      "[role='radio']",
    ].join(",");

    const isVisible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      if (element.closest("[hidden], [aria-hidden='true']")) return false;

      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      if (rect.bottom <= 0 || rect.right <= 0) return false;
      if (rect.top >= window.innerHeight || rect.left >= window.innerWidth) return false;

      return true;
    };

    const hasLargeWrappingLabel = (element) => {
      if (!(element instanceof HTMLInputElement)) return false;
      if (element.type !== "checkbox" && element.type !== "radio") return false;

      const label = element.closest("label");
      if (!label) return false;

      const rect = label.getBoundingClientRect();
      return rect.width >= 40 && rect.height >= 40;
    };

    const elementName = (element) => {
      const label =
        element.getAttribute("aria-label") ||
        element.getAttribute("title") ||
        element.textContent?.trim().replace(/\s+/g, " ") ||
        element.id ||
        element.getAttribute("class") ||
        element.tagName.toLowerCase();

      return label.slice(0, 80);
    };

    const touchTargetIssues = Array.from(document.querySelectorAll(touchTargetSelector))
      .filter(isVisible)
      .filter((element) => !hasLargeWrappingLabel(element))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          name: elementName(element),
          tag: element.tagName.toLowerCase(),
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        };
      })
      .filter((item) => item.width < 40 || item.height < 40);

    return {
      documentWidth,
      innerWidth: window.innerWidth,
      overflow,
      touchTargetIssues,
    };
  });

  const screenshotPath = path.join(outputDir, `${scenario}-${viewport.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const failures = [];
  if (result.overflow) {
    failures.push(
      `${scenario}/${viewport.name}: horizontal overflow ${result.documentWidth}px > ${result.innerWidth}px`,
    );
  }

  for (const issue of result.touchTargetIssues) {
    failures.push(
      `${scenario}/${viewport.name}: ${issue.tag} "${issue.name}" is ${issue.width}x${issue.height}px`,
    );
  }

  return failures;
}

async function checkGeneratorFooter(page, viewport) {
  const issue = await page.evaluate(() => {
    const sheet = document.querySelector(".generator-sheet");
    const panel = sheet?.querySelector(".control-panel");
    const footer = sheet?.querySelector(".generation-section");

    if (!(panel instanceof HTMLElement) || !(footer instanceof HTMLElement)) {
      return "generator footer was not found";
    }

    panel.scrollTop = panel.scrollHeight;

    const panelRect = panel.getBoundingClientRect();
    const footerRect = footer.getBoundingClientRect();
    const visibleHeight = Math.max(
      0,
      Math.min(panelRect.bottom, footerRect.bottom, window.innerHeight) -
        Math.max(panelRect.top, footerRect.top, 0),
    );

    if (visibleHeight < Math.min(40, footerRect.height)) {
      return `generator footer visible height is only ${Math.round(visibleHeight)}px`;
    }

    if (footerRect.bottom > Math.min(panelRect.bottom, window.innerHeight) + 1) {
      return "generator footer extends below the visible panel";
    }

    return null;
  });

  await wait(150);
  await page.screenshot({
    path: path.join(outputDir, `generator-footer-${viewport.name}.png`),
    fullPage: false,
  });

  return issue ? [`generator/${viewport.name}: ${issue}`] : [];
}

async function runViewport(browser, viewport) {
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: viewport.width < 768,
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await context.newPage();
  const failures = [];

  await page.goto(route("/"));
  await hideDevTools(page);
  await page.waitForSelector(".canvas-frame");
  failures.push(...(await auditPage(page, "home", viewport)));

  await page.locator(".control-trigger.left").click();
  await page.waitForSelector(".control-sheet[data-side='left']");
  failures.push(...(await auditPage(page, "control", viewport)));
  await page.keyboard.press("Escape");
  await wait(200);

  await page.locator(".control-trigger.right").click();
  await page.waitForSelector(".generator-sheet[data-side='right']");
  failures.push(...(await auditPage(page, "generator", viewport)));
  failures.push(...(await checkGeneratorFooter(page, viewport)));
  await page.keyboard.press("Escape");
  await wait(200);

  await page.goto(route("/docs/import-product"));
  await hideDevTools(page);
  await page.waitForSelector(".docs-container");
  failures.push(...(await auditPage(page, "docs", viewport)));

  await context.close();
  return failures;
}

await mkdir(outputDir, { recursive: true });

let server;
if (!(await canReach(baseUrl))) {
  if (configuredBaseUrl) {
    throw new Error(`Cannot reach MOBILE_AUDIT_BASE_URL: ${baseUrl}`);
  }
  server = await startDevServer();
}

const browser = await chromium.launch();
const failures = [];

try {
  for (const viewport of viewports) {
    failures.push(...(await runViewport(browser, viewport)));
  }
} finally {
  await browser.close();
  server?.kill();
}

if (failures.length > 0) {
  console.error(`Mobile audit failed with ${failures.length} issue(s):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  console.error(`Screenshots saved to ${outputDir}`);
  process.exitCode = 1;
} else {
  console.log(`Mobile audit passed for ${viewports.length} viewport(s).`);
  console.log(`Screenshots saved to ${outputDir}`);
}
