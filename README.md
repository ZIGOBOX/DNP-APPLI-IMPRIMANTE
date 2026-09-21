# ZiGoBox Suite - Android APK + GitHub Actions

Ce depot contient :
- la page Web ZiGoBox Suite ;
- une application Android WebView ;
- un workflow GitHub Actions qui genere automatiquement un APK.

## APK
Dans GitHub : Actions > Build APK > ouvrir la derniere execution verte > Artifacts > ZiGoBox-Suite-APK.

## Adresse Web
L'application charge par defaut :
https://zigobox.github.io/ZiGoBox-Suite/

Si le nom du depot GitHub Pages est different, modifier START_URL dans :
app/src/main/java/fr/zigobox/suite/MainActivity.java
