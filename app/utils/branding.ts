/**
 * The Zitadel label policy as CSS on top of the LeiCraft_MC design (Zitadel login:
 * `helpers/colors.ts` setTheme + the custom font of `ThemeWrapper`). Only customized values are
 * present in the branding (server/lib/api/utils/shared-models/loginModels.ts), so everything else
 * keeps the LeiCraft_MC tokens of `main.css` / NuxtUI.
 */
import type { LoginBranding, LoginBrandingTheme } from "./loginTypes";

export type ThemeChoice = "light" | "dark" | "system";

const THEME_CHOICE_KEY = "lcmc_auth_login_theme";
const BRANDING_FONT_FAMILY = "LoginBrandingFont";

/** `color-mix` of NuxtUI's surface tokens, so derived surfaces follow the branded colors. */
const mix = (base: string, color: string, percent: number) =>
	`color-mix(in oklab, ${base}, ${color} ${percent}%)`;

function themeVariables(theme: LoginBrandingTheme, mode: "light" | "dark"): string[] {
	const vars: string[] = [];

	if (theme.primaryColor) {
		vars.push(`--ui-primary: ${theme.primaryColor}`);
		vars.push(`--login-on-primary: ${contrastTextColor(theme.primaryColor)}`);
	}

	if (theme.warnColor) {
		vars.push(`--ui-error: ${theme.warnColor}`);
	}

	if (theme.backgroundColor) {
		// the page gets the background, the card a slightly lighter surface of it
		const card =
			mode === "dark"
				? mix(theme.backgroundColor, "white", 5)
				: mix(theme.backgroundColor, "white", 70);
		const text = "var(--ui-text-highlighted)";
		vars.push(`--login-page-bg: ${theme.backgroundColor}`);
		vars.push(`--ui-bg: ${card}`);
		vars.push(`--ui-bg-muted: ${mix("var(--ui-bg)", text, 4)}`);
		vars.push(`--ui-bg-elevated: ${mix("var(--ui-bg)", text, 7)}`);
		vars.push(`--ui-bg-accented: ${mix("var(--ui-bg)", text, 12)}`);
		vars.push(`--ui-border: ${mix("var(--ui-bg)", text, 12)}`);
		vars.push(`--ui-border-muted: ${mix("var(--ui-bg)", text, 9)}`);
		vars.push(`--ui-border-accented: ${mix("var(--ui-bg)", text, 18)}`);
	}

	if (theme.fontColor) {
		const bg = "var(--ui-bg)";
		vars.push(`--ui-text-highlighted: ${theme.fontColor}`);
		vars.push(`--ui-text: ${mix(bg, theme.fontColor, 88)}`);
		vars.push(`--ui-text-toned: ${mix(bg, theme.fontColor, 75)}`);
		vars.push(`--ui-text-muted: ${mix(bg, theme.fontColor, 62)}`);
		vars.push(`--ui-text-dimmed: ${mix(bg, theme.fontColor, 48)}`);
	}

	return vars;
}

/**
 * Stylesheet of a branding: light and dark theme colors and the custom font. Colors are validated
 * hex values and URLs parsed http(s) URLs (server side), so they can't break out of the CSS.
 */
export function brandingCss(branding: LoginBranding | null | undefined): string {
	if (!branding) return "";

	const rules: string[] = [];
	const light = themeVariables(branding.light, "light");
	const dark = themeVariables(branding.dark, "dark");
	if (light.length) rules.push(`:root:not(.dark) { ${light.join("; ")}; }`);
	if (dark.length) rules.push(`:root.dark { ${dark.join("; ")}; }`);

	if (branding.fontUrl) {
		const src = new URL(branding.fontUrl).href.replace(/["\\\n]/g, encodeURIComponent);
		rules.push(
			`@font-face { font-family: "${BRANDING_FONT_FAMILY}"; font-style: normal; font-display: swap; src: url("${src}"); }`,
		);
		rules.push(`:root { --font-sans: "${BRANDING_FONT_FAMILY}", "Rubik", sans-serif; }`);
	}

	return rules.join("\n");
}

/** The theme the user picked with the theme switch (only honored when the branding allows it). */
export function readThemeChoice(): ThemeChoice | null {
	try {
		const value = localStorage.getItem(THEME_CHOICE_KEY);
		return value === "light" || value === "dark" || value === "system" ? value : null;
	} catch {
		return null;
	}
}

export function saveThemeChoice(choice: ThemeChoice) {
	try {
		localStorage.setItem(THEME_CHOICE_KEY, choice);
	} catch {
		// storage unavailable (private mode): the choice lasts for this page only
	}
}
