ZiGoBox - DNP DS-RX1HS Android WebUSB
=====================================

BUT
---
Lire directement les informations de la DNP DS-RX1HS depuis Google Chrome sur Android,
sans PC et sans Wi-Fi entre le téléphone et l'imprimante.

BRANCHEMENT
-----------
DNP DS-RX1HS -> câble USB de l'imprimante -> adaptateur USB-C OTG -> téléphone Android.

INSTALLATION SUR GITHUB PAGES
-----------------------------
1. Décompresser ce ZIP.
2. Mettre les 5 fichiers à la racine du dépôt GitHub.
3. Activer GitHub Pages sur la branche principale.
4. Ouvrir l'adresse https://...github.io/... dans GOOGLE CHROME sur Android.
5. Brancher et allumer la DNP.
6. Toucher « Connecter la DNP ».
7. Android / Chrome affiche une demande d'autorisation USB : choisir la DNP puis autoriser.

IMPORTANT
---------
- WebUSB nécessite HTTPS : GitHub Pages convient.
- Ne pas ouvrir index.html directement depuis l'application Fichiers : WebUSB peut y être bloqué.
- La page ne contient AUCUNE commande d'impression, de remise à zéro ou de maintenance.
  Elle envoie uniquement des requêtes de lecture (état, média, quantité restante, firmware,
  numéro de série, buffers et compteur LIFE).
- Le compteur de consommable de la RX1HS correspond au média papier + ruban. La machine
  n'a pas une cartouche d'encre liquide séparée.
- Une fois la page chargée au moins une fois, le service worker la met en cache afin
  qu'elle puisse être rouverte hors connexion dans la plupart des cas.

PROTOCOLE / IDENTIFIANTS UTILISÉS
---------------------------------
DNP USB VID : 0x1343
DS-RX1 / DS-RX1HS PID : 0x0005
Requêtes : STATUS, INFO/MQTY, INFO/MEDIA, INFO/FREE_PBUFFER, INFO/FVER,
INFO/SERIAL_NUMBER, MNT_RD/COUNTER_LIFE.

SI ÇA NE RÉPOND PAS
-------------------
Ouvrir « Diagnostic USB / réponses brutes », toucher « Copier le diagnostic » et
transmettre le texte. Le prototype pourra alors être adapté au firmware exact de la RX1HS.

Version expérimentale 1.0 - 21/09/2026
