# Avatar library

Profile icons offered in "Edit profile → Change icon". Each folder is one row of the picker; its
name is the row's title. A leading number only orders the rows and isn't shown:

```
avatars/
  01 Classics/
    red.png
    blue.png
  02 Anime/
    ...
```

- Formats: PNG, JPG, WebP, AVIF, GIF or SVG. Square works best; anything else is center-cropped.
- Pictures are resized to 512×512 when picked, so any size works, but keep files small: they ship
  with the app.
- Only use images you have the rights to.

The chosen icon is stored as the user's avatar on the Jellyfin server, so every device shows it.
