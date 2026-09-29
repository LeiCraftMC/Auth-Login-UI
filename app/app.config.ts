export default defineAppConfig({
	ui: {
		colors: {
			primary: "sky",
			neutral: "slate",
		},
		button: {
			// Text on solid primary buttons follows the branding color (utils/branding.ts).
			compoundVariants: [
				{ color: "primary", variant: "solid", class: "text-(color:--login-on-primary)" },
			],
		},
	},
	theme: {
		radius: 0.5,
		blackAsPrimary: false,
	},
});
