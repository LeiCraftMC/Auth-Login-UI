<template>
	<NuxtRouteAnnouncer />
	<UApp>
		<NuxtLayout>
			<!-- remount on every navigation: the login steps differ only by their search parameters -->
			<NuxtPage :page-key="(route) => route.fullPath" />
		</NuxtLayout>
	</UApp>
</template>
