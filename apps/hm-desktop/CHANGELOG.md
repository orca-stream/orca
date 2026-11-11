# Changelog

## [0.7.0](https://github.com/orca-stream/orca/compare/orca-hm-v0.6.0...orca-hm-v0.7.0) (2026-11-11)


### ✨ Features

* **extractors:** read a site's movies and tell them apart in its search ([1eef47a](https://github.com/orca-stream/orca/commit/1eef47afc0afdb2cc3cbbe72402b941fc548e85c))
* **hm:** add movies, OVAs and specials as what they are ([bbaf4f6](https://github.com/orca-stream/orca/commit/bbaf4f648bcbe91f404a72f3e1e2d9f0ab236258))
* **hm:** filter a kind of artwork by its language, or the images with no text ([296224c](https://github.com/orca-stream/orca/commit/296224c885b737c874d252fae28bb7c08d6a0dee))
* **hm:** keep another address of a series as an alternative, switching only the episodes picked ([d61d888](https://github.com/orca-stream/orca/commit/d61d888d212d77e002d99349ac1f001deeb6eb4b))
* **hm:** let the artwork panel be moved and resized, and open it below its button when narrow ([389eb2b](https://github.com/orca-stream/orca/commit/389eb2b0708c55b824c636c03812040ab6281a8e))
* **hm:** move a season to its preferred source when picked, and name where a file came from ([d425213](https://github.com/orca-stream/orca/commit/d425213ddf4a102f9742764fb8029cc2222a9f6e))
* **hm:** show every download with a plain down arrow ([6b2f639](https://github.com/orca-stream/orca/commit/6b2f639ac950dba41ddae4ece79680fc5cbfde1d))
* **hm:** show where an address goes as a choice, New series first, and name Include all ([b2bea61](https://github.com/orca-stream/orca/commit/b2bea61b0be33de41acd8569a73f15ecebdf4e52))


### 🐛 Bug Fixes

* **hm:** keep a site's mark white inside a highlighted list item ([c32f590](https://github.com/orca-stream/orca/commit/c32f5901ae414a35f55e61b7fd3f8376675f09dd))
* **hm:** keep the site result being read lifted and the rest out of reach, and fit Any source ([085fde2](https://github.com/orca-stream/orca/commit/085fde282d5e8ceef036a494c332a455411773f0))
* **hm:** link a movie's TMDB id to its movie page ([4fbc817](https://github.com/orca-stream/orca/commit/4fbc8177a16d3ba1ffce461f9eb379809a196281))
* **hm:** list the preferred source's choices in their colour, without saying which are closed ([66d04bc](https://github.com/orca-stream/orca/commit/66d04bce1632d0503e3d5b671fcb60c24c28776a))
* **hm:** make the marks over an episode's frame one height, and give Missing its icon ([e6a98eb](https://github.com/orca-stream/orca/commit/e6a98ebc63e746ebfefb6f98edd09c97c7308df4))
* **hm:** match Windows paths against Jellyfin's when refreshing the library ([1e8d5d0](https://github.com/orca-stream/orca/commit/1e8d5d00984ad9aec1c77b2942251ba003145c46))
* **hm:** offer a source only for the seasons its address lists ([605a170](https://github.com/orca-stream/orca/commit/605a17071c7742464afd40a121f818d05001a6f7))
* **hm:** open the artwork panel above its button or atop the window when there is no room below ([e092f02](https://github.com/orca-stream/orca/commit/e092f02cf79b73a25aaf4ed349b086ea1e49fedf))
* **hm:** say how many are left to download, and not that a queued movie downloads ([07ec746](https://github.com/orca-stream/orca/commit/07ec7463cb155614e7c15dafa69d47404ef730f3))
* **hm:** scan every Jellyfin library when the one that holds a new series has nothing yet ([e13d3cc](https://github.com/orca-stream/orca/commit/e13d3cc894187272088608387d77d60ebe0396b8))
* **hm:** show an episode's notes as icons with a hover card, and a preferred source as it's picked ([529b75d](https://github.com/orca-stream/orca/commit/529b75d3581cffe82c1bc1fa119a64f0991bbbda))
* **hm:** show only the current setup step's errors and ask for the movies folder ([bf7e922](https://github.com/orca-stream/orca/commit/bf7e92278a8006b25d95b8c84fd1c0de2221394e))
* **hm:** show sizes from a gigabyte with two decimals so progress is felt ([9dd167e](https://github.com/orca-stream/orca/commit/9dd167e3f70f2afda17cc445a1fd3ea75684fecb))
* **hm:** stop the site search from blanking the screen when a page brings the scrollbar ([b00bfd7](https://github.com/orca-stream/orca/commit/b00bfd7bb0c48f7fb2e14b29d7675ab67f6965fd))

## [0.6.0](https://github.com/orca-stream/orca/compare/orca-hm-v0.5.1...orca-hm-v0.6.0) (2026-11-09)


### ✨ Features

* **hm:** lock a read series' address and mark shows already added in the search ([b1336ca](https://github.com/orca-stream/orca/commit/b1336ca85ccb6da5abdc8e30448f0c52d8a03217))
* **hm:** read a site's search page after page ([a958c0c](https://github.com/orca-stream/orca/commit/a958c0c425977cdcddc6521a9a1f6e99b643a518))
* **hm:** read a site's search page by page and leave out what is not a series ([6d300d2](https://github.com/orca-stream/orca/commit/6d300d27f8fdb1258ffab238fa9af9e5c551517f))
* **hm:** say a name is too short inside the add series bar ([1e9482e](https://github.com/orca-stream/orca/commit/1e9482e0236049fdd974ad673cbb010082236c44))
* **hm:** search a site through a POST API with slugged result addresses ([f81b905](https://github.com/orca-stream/orca/commit/f81b90569bb361040afee1b2d3dc44c90f63aa32))
* **hm:** search a site through the results written in its search page ([b82b17a](https://github.com/orca-stream/orca/commit/b82b17a25f4d7a47c91758f4ae8a2fb4205ed95c))
* **hm:** search the sites by name from the add series address ([99c660d](https://github.com/orca-stream/orca/commit/99c660dbef823a47a310b7f823bd90bed05cde3c))
* **hm:** show the sites' search results as a paged grid ([dd65389](https://github.com/orca-stream/orca/commit/dd653893724ecd20bbea6c339c614c7108dc74bd))
* **hm:** slide a search result's site name out of its icon on hover ([d4c2036](https://github.com/orca-stream/orca/commit/d4c203679416a9ed7df0d1036dd6ccfd2ccfcd54))
* **hm:** tell a site's results with the same title apart by their seasons ([37b956d](https://github.com/orca-stream/orca/commit/37b956df0414a51aa0890b6966a102709cdc108d))
* **hm:** use a refresh icon to start adding a series over ([fccc8bd](https://github.com/orca-stream/orca/commit/fccc8bd519928d6d48d55f838cfc2b93d7fe60ba))


### 🐛 Bug Fixes

* **hm:** know a show added season by season in a site's search and read its name from the page ([9b586f8](https://github.com/orca-stream/orca/commit/9b586f8c88d5955b7d804ef9ec0e6066efffacd3))
* **hm:** name a series picked from a site's search as the search wrote it ([67000a9](https://github.com/orca-stream/orca/commit/67000a9fb8171c392aa4c463acce4119e64619b9))
* **hm:** recognize a show already added from another of its site's domains ([f51f424](https://github.com/orca-stream/orca/commit/f51f4247c89de9b32ad0a358cadc0d3b6af64fbb))

## [0.5.1](https://github.com/orca-stream/orca/compare/orca-hm-v0.5.0...orca-hm-v0.5.1) (2026-11-09)


### 🐛 Bug Fixes

* **deps:** bump the npm group with 4 updates ([5d234f5](https://github.com/orca-stream/orca/commit/5d234f55568d090883108b2af9aaf0b5c682ddc8))

## [0.5.0](https://github.com/orca-stream/orca/compare/orca-hm-v0.4.0...orca-hm-v0.5.0) (2026-11-09)


### ✨ Features

* **hm-desktop:** install and update the app on Windows

## [0.4.0](https://github.com/orca-stream/orca/compare/orca-hm-v0.3.3...orca-hm-v0.4.0) (2026-11-09)


### ✨ Features

* **hm-desktop:** choose hardware acceleration in Settings, with a restart button
* **hm-desktop:** reopen the window where it was last closed
* **hm-web:** choose a new series' artwork while adding it
* **hm-web:** search TMDB by name from the new series' title


### 🐛 Bug Fixes

* **hm-server:** keep the chosen series artwork from being replaced by Jellyfin
* **hm-web:** keep the desktop app's popups from being clipped
* **hm-web:** refresh what TMDB says of a show after an hour


### ⚡ Performance

* **hm-web:** drop the backdrop blur from cards a cover fills

## [0.3.3](https://github.com/orca-stream/orca/compare/orca-hm-v0.3.2...orca-hm-v0.3.3) (2026-11-08)


### 🐛 Bug Fixes

* **hm-web:** let the desktop app's pages scroll

## [0.3.2](https://github.com/orca-stream/orca/compare/orca-hm-v0.3.1...orca-hm-v0.3.2) (2026-11-08)


### 🐛 Bug Fixes

* **hm-desktop:** count the step after the download as installing

## [0.3.1](https://github.com/orca-stream/orca/compare/orca-hm-v0.3.0...orca-hm-v0.3.1) (2026-11-08)


### 🐛 Bug Fixes

* **hm-desktop:** look for updates in the app's own repository

## [0.3.0](https://github.com/orca-stream/orca/compare/orca-hm-v0.2.1...orca-hm-v0.3.0) (2026-11-08)


### ✨ Features

* **hm-desktop:** look for updates on demand, and offer them in the tray


### 🐛 Bug Fixes

* **hm-desktop:** call fetching newer tools an update, not the first start
* **hm-desktop:** say whether an update is downloading or installing

## [0.2.1](https://github.com/orca-stream/orca/compare/orca-hm-v0.2.0...orca-hm-v0.2.1) (2026-11-08)


### 🐛 Bug Fixes

* **deps:** bump the npm group across 1 directory with 4 updates

## [0.2.0](https://github.com/orca-stream/orca/compare/orca-hm-v0.1.0...orca-hm-v0.2.0) (2026-11-08)


### ✨ Features

* **hm-desktop:** update from the app's own APT repository in one click
* **hm-web:** show an update's progress and a retry in the title bar
