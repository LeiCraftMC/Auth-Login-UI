/**
 * Avatar colors derived from the login name (Zitadel login: `helpers/colors.ts` getColorHash):
 * the 900 and 200 shades of the Tailwind palette (swapped in the light theme, see LoginAvatar).
 */
const AVATAR_COLORS = [
	{ background: "#7f1d1d", text: "#fecaca" }, // red
	{ background: "#7c2d12", text: "#fed7aa" }, // orange
	{ background: "#78350f", text: "#fde68a" }, // amber
	{ background: "#713f12", text: "#fef08a" }, // yellow
	{ background: "#365314", text: "#d9f99d" }, // lime
	{ background: "#14532d", text: "#bbf7d0" }, // green
	{ background: "#064e3b", text: "#a7f3d0" }, // emerald
	{ background: "#134e4a", text: "#99f6e4" }, // teal
	{ background: "#164e63", text: "#a5f3fc" }, // cyan
	{ background: "#0c4a6e", text: "#bae6fd" }, // sky
	{ background: "#1e3a8a", text: "#bfdbfe" }, // blue
	{ background: "#312e81", text: "#c7d2fe" }, // indigo
	{ background: "#4c1d95", text: "#ddd6fe" }, // violet
	{ background: "#581c87", text: "#e9d5ff" }, // purple
	{ background: "#701a75", text: "#f5d0fe" }, // fuchsia
	{ background: "#831843", text: "#fbcfe8" }, // pink
	{ background: "#881337", text: "#fecdd3" }, // rose
] as const;

function hashCode(str: string, seed = 0): number {
	let h1 = 0xdeadbeef ^ seed;
	let h2 = 0x41c6ce57 ^ seed;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function avatarColor(value: string) {
	if (!value) return AVATAR_COLORS[0];
	return AVATAR_COLORS[hashCode(value) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}

/** Initials of a display name, or of the login name's local part (`jane.doe@…` → `jd`). */
export function initials(name: string | null | undefined, loginName: string) {
	if (name) {
		const [first = "", second] = name.split(" ");
		return first.charAt(0) + (second ? second.charAt(0) : "");
	}

	const username = loginName.split("@")[0] ?? "";
	let separator = "_";
	if (username.includes("-")) separator = "-";
	if (username.includes(".")) separator = ".";
	const [first = "", second] = username.split(separator);
	return first.charAt(0) + (second ? second.charAt(0) : "");
}

/** Relative luminance (WCAG) of a `#rgb` / `#rrggbb` color. */
export function relativeLuminance(hex: string): number {
	const value = hex.replace("#", "");
	const full =
		value.length === 3
			? value
					.split("")
					.map((c) => c + c)
					.join("")
			: value;
	const channels = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255);
	const [r = 0, g = 0, b = 0] = channels.map((c) =>
		c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
	);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const DARK_TEXT = "#0f172a";
const LIGHT_TEXT = "#ffffff";

/** WCAG contrast ratio of two relative luminances. */
function contrastRatio(a: number, b: number) {
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Dark or white text, whichever contrasts more with the given background color. */
export function contrastTextColor(hex: string) {
	const background = relativeLuminance(hex);
	return contrastRatio(background, relativeLuminance(DARK_TEXT)) >
		contrastRatio(background, relativeLuminance(LIGHT_TEXT))
		? DARK_TEXT
		: LIGHT_TEXT;
}
