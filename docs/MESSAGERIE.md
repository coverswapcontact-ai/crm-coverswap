# Messagerie et relances préparées (mission 25, 10/10/2026)

Conception de ce qui est livré dans `src/lib/messagerie/` (cahier « Relances et messagerie CoverSwap », version du
10/10). Le code dit comment ; ici, pourquoi, et où chaque règle du cahier vit.

## 1. Le principe

Tout ce qui arrive dans un dossier (lead, réponse, note, photos, devis ouvert, silence) est analysé : le dossier est
mis à jour (faits, journal, « Où on en est », prochaine action) et l'action suivante est préparée — un message de la
liste validée, à l'heure permise, après la garde de silence. **Mode Manuel** : rien ne part seul. Lucas reçoit une
alerte, ouvre Messages (numéro et texte remplis), envoie, et touche « ✅ Envoyé ». Le mode Android (lot 8) ne change
qu'une chose : les messages réglés Auto partiront seuls par le téléphone Android.

## 2. Les données (ajouts seulement)

| Modèle | Rôle |
|---|---|
| `Suivi` | un par dossier, ou par lead tant qu'il n'a pas de dossier (le suivi passe au dossier quand il arrive : mêmes faits, même journal, mêmes messages) ; faits, « Où on en est » (+ correction de Lucas), prochaine action, pause, STOP, démarrage en douceur, lu / non lu, archivage de la conversation, `revoirLe` (prochain passage du moteur) |
| `LigneJournalSuivi` | une ligne datée par événement (Client, Toi, IA, CRM), clé unique : rejouer n'écrit rien de plus |
| `MessagePrepare` | un message préparé : code de la liste, clé unique (`A1:lead:…`, `D2:<devis>`, `S2:<simulation>`, `C1:suivi:…:<date>`, `REPONSE:<message du client>`…), canal, texte (personnalisé et contrôlé) et texte validé, heure prévue, statut (PREVU, A_ENVOYER, A_VALIDER, ENVOYE, NON_ENVOYE, RETENU, ANNULE), mode Android (AUTO, VALIDATION, DESACTIVE) |
| `ModeleSms.mode` | le mode réglé par Lucas pour un code (Paramètres → SMS) ; le texte modifié vit dans `ModeleSms.texte` (code `P3`, ou `P3.proche` pour une variante) |

Paramètres (groupe « Messagerie et relances ») : `MESSAGERIE_MODE_ENVOI` (Manuel par défaut), `MESSAGERIE_PAUSE`
(« Tout mettre en pause »), `MESSAGERIE_LANCEMENT` (posé au premier passage), `MESSAGERIE_LIEN_AVIS` (fiche Google) ;
groupe IA : `IA_MESSAGERIE` (interrupteur), `IA_MESSAGERIE_BUDGET` (10 € sans valeur, alerte à 80 %).

## 3. La boucle

1. Un geste du CRM appelle déjà `signalerChangementTaches()` : il met aussi en file `MESSAGERIE_SCAN` (4 s, une seule
   tâche pour une rafale). L'arrivée d'un lead (`envoyerAccuseDeReception`, appelé par le webhook du site et par Meta)
   fait de même : l'ancien accusé par le fournisseur est remplacé par A1.
2. Le balayage (`moteur.ts › balayer`) repère ce qui a bougé depuis le précédent (événements, dossiers, leads,
   interactions, notes d'appel, SMS, devis, simulations, espaces, accords, paiements) et met en file l'analyse de chaque
   suivi touché : **90 s après le dernier message d'un client** (une seule analyse pour trois messages en deux minutes),
   2 s sinon.
3. L'analyse (`analyse.ts`) : lit l'état (`etat.ts`), écrit les lignes de journal nouvelles (les dix dernières à la
   première), analyse les messages du client et les notes (IA si active, sinon `regles.ts`), met à jour les faits,
   prépare les messages voulus (`planificateur.ts` + `redaction.ts`), passe ce qui est dû par la garde, recalcule
   « Où on en est » et la prochaine action.
4. Le moteur : une tâche par quart d'heure à l'heure prévue des messages (`MESSAGERIE_ECHEANCE`), et le passage de
   15 minutes (`messagerie-moteur`) : rattrapage, suivis à créer (paquets de 40), suivis à revoir (`revoirLe`),
   échéances, 19 h 30, alertes. **L'IA n'est jamais appelée par le moteur** : seulement par une analyse, donc un
   événement.

## 4. Où vivent les règles du cahier

| Règle | Où |
|---|---|
| 1 numéro, le SMS ouvert dans Messages (`sms:…&body=` iPhone, `?body=` Android) | `texte.ts › lienSms`, `CarteMessage.tsx` |
| 3 « Où on en est » toujours vrai, 240 caractères, jamais vide | `ou-en-est.ts` (règles) ; l'IA peut réécrire les deux premières lignes |
| 4 Liste fermée, modes | `catalogue.ts` (41 entrées : 32 + CC + 8 Q), `redaction.ts › lireSurcharges` |
| 5 Le silence gagne | `garde.ts` |
| 7, 8 Un message un objectif ; jamais de prix ni de date inventés | `controleur.ts` (textes de l'IA seulement ; les textes de la liste sont validés) |
| 9 Présentation et prénom | `catalogue.ts` (seul A1 se présente), `texte.ts › prenomFiable` |
| 10 Le lien proposé, jamais imposé | P2 sans lien sauf après P1 ; S2 « SMS d'abord » avec l'image |
| 11 Horaires, fériés, pression | `horaires.ts`, `garde.ts` (48 h, trois par étape), `analyse.ts` (40 par jour, 8 propositions douces) |
| 12 Tout est tracé | `LigneJournalSuivi` (préparé, prêt, décalé, retenu, annulé, envoyé, non envoyé) |

## 5. Décisions prises seul (le cahier ne tranchait pas)

- **Natures de message** : les relances de silence (P2, P3, S3–S5, D2–D5, D7, C4, C5, F1, R1, R2) suivent toute la
  garde (48 h, trois par étape, client qui a répondu, appel de moins de 72 h, main à Lucas) ; les messages qui suivent
  un fait daté (A2, A4, A5, P1, S2, D1, C1–C3, E3, CC) suivent les horaires et les gardes dures seulement — sinon A2
  « 2 min après l'appel » serait toujours retenu par A1 parti une heure avant.
- **« Le délai repart de cet échange »** : une relance due alors que le client a écrit depuis le dernier message est
  décalée de deux jours après son message (« décalée au 13/10 : le client a répondu »), pas annulée.
- **« Comme convenu » (CC)** : écrit d'après l'exemple du cahier (« Comme convenu, je reviens vers vous pour votre
  devis. Avez-vous pu y réfléchir ? » ; sans devis : « … pour votre projet de {pièce} »), en Validation ; les relances
  attendent qu'il soit parti.
- **A1** seulement pour les leads venus d'un formulaire (site, Meta, Instagram, TikTok), pas pour un contact saisi à la
  main ; A1 et l'accusé du soir (E2) ne sortent pas le lead d'« À appeler » (ce n'est pas un contact).
- **C2 un dimanche ou un férié** : le dernier créneau permis avant (samedi 12 h).
- **F1, R1, R2** sur de vieux dossiers : plus proposés au-delà de 45 jours de retard.
- **Zone inconnue** (code de l'Hérault ou du Gard absent de la table, ville illisible) : la variante « au-delà », qui
  ne promet aucune visite.
- **Pièce inconnue** : « votre intérieur », « votre projet de rénovation » ; accords (« votre mobilier rénové »).
- **Lien d'avis** : la fiche Google (`MESSAGERIE_LIEN_AVIS`) ; sans lien saisi, l'espace du client (`#apres`).
- **Visite (Q5)** : deux jours libres de l'agenda Google seulement ; agenda non lu : « je regarde et je reviens vers
  vous » (Q6), jamais un créneau inventé.
- **Réponse sans IA** : Q6 (« Bien reçu, je regarde et je reviens vers vous très vite. ») pour le prix, « trop cher »,
  un mécontentement, une question, le reste ; E1 pour un lien perdu ; E3 avec le rappel posé pour des disponibilités
  datées ; rien pour un merci ; S1 pour des photos. La FAQ validée n'existant pas encore, les questions générales
  reçoivent Q6.
- **Notes vocales** : la dictée du clavier du téléphone (le cahier le prévoit pour la zone de saisie) ; aucun audio
  n'est enregistré, rien à supprimer.
- **Horizon** : un message n'est écrit que dans les 24 h qui précèdent son heure ; la suite plus lointaine figure dans
  « Où on en est » (« Client : on attend ; D4 le … »).
- **Ancien circuit** : l'accusé par le fournisseur est remplacé par A1 (`envoyerAccuseParFournisseur` gardé pour le
  lot 8) ; les mails de relance proposés toutes les 6 h ne tournent plus (`estActif: false`) ; les comptes de relances
  d'avant (SMS copiés, mails de relance) comptent dans « trois par étape ».
- **Mention STOP** : ajoutée au moment d'envoyer le premier SMS à un numéro (`vues.ts › premiersSms`), pas en
  préparant : trois messages préparés d'avance ne la portent pas tous. Le texte noté comme envoyé la contient.
- **Dossier « Démo Messagerie »** : créé par un bouton (menu de la Messagerie), pas au déploiement : l'alerte part
  quand Lucas l'a demandée, après avoir accepté les notifications (recette, points 1 et 2). Recréer la démo archive la
  précédente. Lead Meta fictif (06 39 98 00 18, Lattes, cuisine) : à archiver après l'essai.
- **Paramètres → SMS (lot 3)** : un texte modifié qui ne pourrait pas partir juste est refusé (variable que le CRM ne
  remplit pas pour ce texte, lien retiré, adresse écrite en dur) ; les règles du contrôleur (une question, montant,
  date, présentation…) sont seulement signalées : Lucas reste l'auteur de ses textes. « Revenir au texte validé » vide
  la ligne (le texte de la liste s'applique et suit ses corrections futures).
- **« Désactivé »** vaut dans les deux modes : un message désactivé n'est jamais préparé, et le journal le dit
  (« … non préparé : désactivé dans Paramètres → SMS »). Une réponse rapide n'a pas de mode.
- **Anciens SMS de l'écran SMS** : les 13 textes qui se présentaient, et la signature « À très vite, Lucas de
  CoverSwap » d'A_RAPPELER (règle d'or 9), sont réécrits sans présentation ; en base, seulement là où la ligne porte
  encore l'ancien texte mot pour mot (migration `sms-sans-presentation-25`). Les deux accusés, remplacés par A1,
  ne s'affichent plus dans Paramètres (leurs lignes restent).
- **Réglages par défaut** : Manuel et « Active » sont posés une fois (migration `messagerie-reglages-25`, datés du
  25/09) pour que Paramètres les montre au lieu de « À renseigner ».
- **Contrôleur** : les mots se reconnaissent accents compris (« prête » n'est plus pris pour « te ») ; relevé en
  remplissant les 41 messages pour cinq profils de clients.
- **Accord de la pièce** : « nouvel intérieur » devant une voyelle, « nouveau local », « nouvelle cuisine ».
- **Anciens leads (lot 6)** : seulement ceux encore « À appeler » (jamais appelés, jamais contactés, sans rappel)
  reçus avant le 25/09/2026 minuit (Paris) ; un lead déjà appelé (« À rappeler ») ou sans suite ne bouge pas. Le
  bouton montre le nombre exact, la confirmation le répète ; « Annuler » restaure (par paquets de 200).
- **Fiche dossier** : seule « Prochaine action » est ouverte par défaut ; les sections que Lucas ouvre ou ferme sont
  retenues sur l'appareil (stockage local), d'un dossier à l'autre ; un raccourci (« Répondre », « Encaisser »…) ouvre
  sa section sans la retenir. Le reste du dossier d'avant (délais, dépenses, étapes et notes, chronologie, archivage)
  garde une dernière section : rien n'a disparu.
- **Ancien circuit de relances** : dès la mise en service de la messagerie, le détecteur RELANCES ne propose plus rien
  et ses tâches ouvertes passent « Pas à faire » avec la raison « relance confiée à la messagerie » (une relance jamais
  faite n'est pas « Faite ») ; une relance déjà faite garde sa preuve. La feuille « relances proposables » n'est plus
  ouverte depuis Leads : la ligne du jour compte les messages de la messagerie et ouvre « Un par un ».
- **Espace perdu dans le JSX** : un texte qui suit une expression et contient une entité (`&apos;`) perd son espace de
  tête à la compilation (« 0 rappelaujourd'hui ») : écrire ces phrases en chaîne JavaScript (`{`…`}`).

