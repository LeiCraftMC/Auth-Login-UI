/**
 * useBrandingTheme — applies the branding (label policy) of the current page, called once by the
 * layout: the theme mode (Zitadel login: `ThemeWrapper`), the light / dark colors and the custom
 * font as a stylesheet (utils/branding.ts) and the branding icon as favicon.
 *
 * Theme mode: `light` / `dark` force the theme; `auto` follows the system unless the user picked
 * one with the theme switch; `unspecified` (Zitadel's default) keeps the LeiCraft_MC dark theme
 * unless the user picked one.
 */
import { useBrandingStore } from "~/composables/stores/useBrandingStore";

export function useBrandingTheme() {
	const branding = useBrandingStore().data;
	const colorMode = useColorMode();
	const { baseURL } = useRuntimeAppConfigs();

	watch(
		() => branding.value?.themeMode,
		(mode) => {
			if (!mode) return;
			if (mode === "light" || mode === "dark") {
				colorMode.preference = mode;
				return;
			}
			colorMode.preference = readThemeChoice() ?? (mode === "auto" ? "system" : "dark");
		},
		{ immediate: true },
	);

	const icon = computed(() => {
		const current = branding.value;
		const dark = colorMode.value === "dark";
		const own = dark ? current?.dark.iconUrl : current?.light.iconUrl;
		const other = dark ? current?.light.iconUrl : current?.dark.iconUrl;
		return own ?? other ?? `${baseURL}/favicon.ico`;
	});

	useHead({
		style: [{ key: "lcmc-login-branding", textContent: computed(() => brandingCss(branding.value)) }],
		link: [{ key: "icon", rel: "icon", href: icon }],
	});
}
