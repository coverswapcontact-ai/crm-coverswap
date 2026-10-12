/**
 * Mission 25 (corrections du 12/10) — les prénoms reconnus : un prénom n'est écrit au client (« Bonjour Marie, ») que
 * s'il figure ici, minuscules sans accent ; un pseudo ou un surnom (« Loulou », « Titi », « Steph ») et un nom de
 * famille rangé dans le champ prénom (« Exemple ») n'y sont pas : « Bonjour, » tout court. Table embarquée, sans
 * service externe : les prénoms courants en France (toutes générations), et ceux des familles maghrébines,
 * portugaises, espagnoles, italiennes et d'Afrique de l'Ouest nombreuses dans la région. Pas de diminutif (Jeff, Mike,
 * Vicky…) : un vrai prénom absent de la liste donne « Bonjour, », c'est l'erreur sans conséquence ; l'inverse ne doit
 * jamais arriver.
 */

const FEMININS = `
marie anne jeanne francoise monique nicole catherine nathalie isabelle sylvie martine christine christiane chantal
brigitte sophie valerie sandrine stephanie veronique celine laurence patricia dominique corinne helene florence
aurelie julie caroline emilie virginie delphine karine carine laetitia leticia audrey melanie elodie sabrina jessica
vanessa marion camille laura sarah sara pauline manon lea chloe emma ines jade louise alice lina rose anna mila ambre
julia lou agathe zoe juliette romane lola clara lucie charlotte eva oceane margaux margot maelys justine mathilde
anais elise noemie morgane amandine marine claire elsa estelle severine angelique cecile magali myriam ingrid fabienne
pascale muriel murielle beatrice evelyne josiane jacqueline danielle daniele denise suzanne simone yvette yvonne
colette ginette paulette odette germaine madeleine marguerite lucienne raymonde georgette huguette annie michele
mireille arlette gisele josette therese bernadette claudine genevieve marcelle andree renee rolande lucette irene
eliane liliane viviane sylviane joelle noelle maryse marylene marlene maryline marilyne marilyn sandra carole karen
nadine nelly regine solange francine ghislaine jocelyne edith agnes aline alexandra alexia aurore axelle barbara
berengere berenice blandine capucine carla cassandra christelle chrystelle clemence coralie cyrielle daphne diane edwige
eleonore elisabeth elizabeth emeline emmanuelle eugenie fanny flora gaelle geraldine gwenaelle heloise hortense iris
jennifer johanna jordane josephine judith julienne lena leila leonie lise lisa lison louna luce lucile ludivine lydie
mae maelle maeva maite manuela marianne mariane marina marjorie marthe maud maude melissa melodie mylene nina oriane
ornella pascaline perrine priscilla rachel rebecca rosalie roxane roxanne sabine salome samantha segolene sibylle
soline solene stella tatiana tiphaine valentine victoire violette yasmine yolande zelie wanda nadia sonia kelly cindy
cynthia jenny lorena lorene loane lilou lily lilly olivia olympe apolline albane alix anaelle andrea angele angelina
annabelle annick armelle aude ava bertille brune cathy clarisse claudette cleo constance coline deborah dorothee elea
eline elina emy enora erika eve faustine felicie fiona gabrielle gladys gwendoline helena hermine ilona isaure jeanine
jeannine jeannette joanna josee kim laure laurie leana leane leonor lilia line lisette louane lyna lyne madison maelia
malia manel mariette marielle marilou maryam mathilda maylis megane meline melina mia micheline nadege naomie natacha
ninon noa noelie nolwenn odile ophelie paola paule perle philippine prisca raphaelle rosine selena shana sidonie sofia
tess tessa thais thea valeria vera victoria yaelle yaelle annie berthe blanche emilienne fernande gilberte henriette
jeannine julie laurette leontine lea louisette marcelline mauricette micheline nathaly nicolle noella pierrette
rolande simone yveline yvelyne corine coraline cristelle evelyn gaelle gwenola katia katy laeticia lauriane
lauryne leslie lindsay loren lorine ludmila madeleine mallory marika maud melinda morane nathalia nicole
noeline océane romy rosa sabina sylvana sylvia tania tifenn valentina yaelle yasmina yolene zoe annelise
annelyse anouk clotilde domitille edmee eulalie ghyslaine guillemette huguette jacinthe jessie josiane lorette
madeline marielle maryvonne nathaelle nolwen pervenche servane soizic suzon sylviane violaine fleur eden lya
alma aurelia sylvette
`;

const MASCULINS = `
jean pierre michel philippe alain patrick nicolas christophe daniel bernard eric frederic laurent stephane david
olivier sebastien thierry julien pascal jerome francois thomas vincent jacques gerard didier sylvain franck frank
bruno anthony antony mickael michael mikael cedric guillaume florian romain kevin maxime alexandre antoine mathieu
matthieu benjamin jonathan fabrice yannick yanick arnaud damien ludovic gregory herve joel serge marc yves gilles
emmanuel rene claude robert roger andre henri louis paul hugo lucas leo gabriel raphael arthur nathan ethan jules adam
enzo tom theo noah liam sacha mael timeo nolan maxence clement baptiste quentin valentin alexis adrien victor tristan
simon martin samuel axel georges marcel raymond lucien maurice fernand albert roland guy yvon gaston gilbert lionel
loic mathis matheo mattheo nathanael noe aaron elias esteban evan gabin lenny lorenzo louka luca mathys milo nael
sohan tiago timothee titouan yanis yann yohan yoann yoan johan jordan dylan brandon steven steve johnny jimmy jeremy
jeremie jessy kylian killian kilian mehdi rayan ryan ilyes ilian elio eliott eliot emilien emile ewan gaspard hector
isaac jacob joseph josue jason jordi leandre leon lilian loris luc malo marius mateo matis morgan naim nelson noam
oscar pablo remi remy richard rodolphe romuald ruben sami samy tanguy teddy terence theophile thibault thibaut tony
ugo valery vianney victorien wilfried wilfrid william xavier yvan zacharie charles christian cyril cyrille denis
dimitri edouard etienne eugene fabien felix fernando florent francis gael gaetan gauthier gautier geoffrey germain
gregoire hadrien hubert hugues joachim jocelyn joris julian karl laurian marco mathias max norbert patrice philibert
raoul regis renaud romaric sylvestre urbain vivien alban albin alfred amaury ambroise anatole anselme antonin aristide
armand aurelien barthelemy basile benoit bertrand blaise boris brice cesar clovis come constant corentin desire
dorian edgar edmond elie eloi elouan emeric enguerrand erwan erwann eudes ferdinand florentin gerald gervais gildas
guilhem hippolyte honore horace ignace isidore jacky joan jonas josselin justin lazare leopold lino loup lubin marceau
marin matteo melvin milan nathael norman octave odilon pacome pierrick prosper rafael rodrigue romeo sandro sebastian
solal stanislas thaddee theodore tobias ulysse vladimir wesley andy angelo anthonin apollinaire arsene augustin
auguste baudouin bastien benoît christopher cyprien daniel dany didier donovan elian emilio enzo evrard fabian
fabrizio flavien freddy frederick gilian gwenael gwendal harold hans herbert ivan jacky jean-baptiste
jerry jules justin kenny kevin lancelot laurens lenaic loan logan lohan lorenzo maceo maxence mickael
mohand morgan nathanaël nils noham olivier patrick pierre-louis quentin ralph randy raphael raymond reda rene ricky
rodrigue roman sacha samson sasha stephan sylvere teo theo thibaud timothe tristan vadim vincent wilson yann
yanis yoni youri zakaria zinedine kenzo kylian lorenz maxim nino orlando rocco sergio vittorio
`;

const MAGHREB_AFRIQUE = `
mohamed mohammed mohamad mohammad ahmed ahmad ali karim farid rachid samir nabil yassine ilyes ilias sofiane soufiane
bilal hamza amine walid mourad djamel kamel said youssef youcef omar khalid khaled hassan hicham abdel abdelkader
abdellah abdelaziz abdelkrim abdelhak abdelali abdelhamid abdelmajid aziz brahim driss fouad hakim ibrahim ismael
ismail jamal jamel kader larbi lotfi malik mustapha mustafa nadir nordine noureddine othmane redouane ridha riad riyad
slimane tarik tarek toufik yacine yahia yassir yazid younes zakaria adel adil anis ayoub badr chakib fares farouk habib
hamid hassen hocine idir imad issam kamal khalil lyes madjid mahmoud mounir nassim nasser nazim rabah rayane sabri salah
salim selim sofian wassim zaki amar azzedine belkacem boualem djamal elyes fethi hafid hakim hamed hichem jalil kais
kheireddine lakhdar lamine mahdi majid mehdi mokhtar mounir nacer nadjib nassim rachid ramzi rida saad saïd samy
smail sofien taha wahid yanis youness zoubir
fatima fatiha farah nadia samira leila malika karima naima rachida khadija yasmina amina myriam meriem meryem sonia
salima houda imane ines nawel lina yasmine soraya zohra djamila hafsa asma hanane siham aicha amel amira assia aziza
dalila dounia fadila farida fatna habiba hayat hind hinda houria ilham jamila kahina kenza latifa lamia louiza
loubna malak maissa mina mounia nabila nadira najat nora nour nouria rania rim saida sabah safia salma samia sara
sihem souad warda wafa yamina zahra zineb zoubida lamya aida alia anissa assia chahrazed chaima chérifa djazia
fadwa ghizlane hajar halima hasna ikram inas jihane kawtar leïla lila lilia linda lynda maroua meriam mouna nadjet
nesrine nihad noura ouarda radia rahma saliha samar sanaa selma soumaya wassila yamna zakia zina zoulikha
fatou aminata mariama awa aissatou oumou kadiatou moussa mamadou ibrahima ousmane amadou boubacar cheikh abdoulaye
seydou souleymane adama alassane babacar bakary demba issa lamine mamadi modibo sekou serigne youssouf aïssata
binta coumba dieynaba fanta hawa khady kadi maimouna ndeye oumy rokhaya sokhna
`;

const IBERIQUE_ITALIEN = `
ana maria isabel isabela carla fernanda rosa conceicao manuela paula helena joana teresa graca filomena lurdes rosario
esperanza dolores carmen pilar mercedes concepcion josefa alcina adelaide angela anabela antonia celia cristina dina
elisabete emilia fabiola gloria lucia luisa luiza margarida marta natalia olga raquel rita silvia susana vera
jose antonio manuel carlos francisco joao pedro paulo fernando luis jorge miguel rui nuno sergio ricardo vitor alberto
alvaro armando artur diogo eduardo fabio filipe gil goncalo henrique jaime joaquim julio lourenco mario orlando raul
renato rodrigo rogerio valter vasco
giovanni giuseppe paolo francesca giulia chiara alessandro andrea carlo franco gianni luigi massimo pietro roberto
salvatore stefano vincenzo alessandra bianca elena federica giorgia ilaria martina roberta serena simona valentina
`;

const AUTRES = `
wendy brenda sharon shirley tiffany nancy linh mai lan anh minh hoa thanh tuan hung duc
`;

const CONNUS = new Set(
  [FEMININS, MASCULINS, MAGHREB_AFRIQUE, IBERIQUE_ITALIEN, AUTRES]
    .join(" ")
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => normaliserPrenom(p))
);

/** « Hélène » → « helene » ; « ÔDILE » → « odile ». */
export function normaliserPrenom(mot: string): string {
  return mot.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’']/g, "'").trim();
}

/**
 * Le mot est un prénom connu ; un prénom composé (« Marie-Claire », « Jean-Pierre ») l'est si chacune de ses parties
 * l'est. Les prénoms d'une ou deux lettres ne le sont jamais (initiales, abréviations).
 */
export function estPrenomConnu(mot: string): boolean {
  const n = normaliserPrenom(mot);
  if (n.length < 3) return false;
  if (CONNUS.has(n)) return true;
  const parties = n.split("-");
  return parties.length > 1 && parties.every((p) => p.length >= 2 && CONNUS.has(p));
}
