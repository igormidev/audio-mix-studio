import type { EpidemicCatalog } from "./epidemic";

/**
 * Public Epidemic Sound catalog snapshot, retrieved 2026-10-29.
 * Canonical slugs come from the linked official genre/mood/category pages,
 * never from a label-to-slug guess. MCP provides filtering, but no taxonomy
 * listing tool. The three instrument suggestions are the MCP schema examples;
 * themes are topic-search phrases, not MCP collections. Key/decade/region
 * suggestions were individually verified with live MCP filter queries.
 * See docs/EPIDEMIC_SOUND.md.
 */
export const EPIDEMIC_CATALOG: EpidemicCatalog = {
  genres: [
    {
      label: "Pop",
      value: "pop",
    },
    {
      label: "Jazz",
      value: "jazz",
    },
    {
      label: "Electronic",
      value: "electronic",
    },
    {
      label: "Hip Hop",
      value: "hip-hop",
    },
    {
      label: "Funk",
      value: "funk",
    },
    {
      label: "Country",
      value: "country",
    },
    {
      label: "Rock",
      value: "rock",
    },
    {
      label: "Classical",
      value: "classical",
    },
    {
      label: "R&B",
      value: "rb",
    },
    {
      label: "Soul",
      value: "soul",
    },
    {
      label: "Beats",
      value: "beats",
    },
    {
      label: "Acoustic",
      value: "acoustic",
    },
    {
      label: "Abstract Hip Hop",
      value: "abstract-hip-hop",
    },
    {
      label: "Solo Guitar",
      value: "solo-guitar",
    },
    {
      label: "Solo Piano",
      value: "solo-piano",
    },
    {
      label: "Acoustic Rock",
      value: "acoustic-rock",
    },
    {
      label: "Afoxê",
      value: "afoxe",
    },
    {
      label: "Ambient",
      value: "ambient",
    },
    {
      label: "ASMR",
      value: "asmr",
    },
    {
      label: "Binaural Beats",
      value: "binaural-beats",
    },
    {
      label: "Drone",
      value: "drone",
    },
    {
      label: "Meditation",
      value: "meditation",
    },
    {
      label: "Ambient Americana",
      value: "ambient-americana",
    },
    {
      label: "Ambient Dub",
      value: "ambient-dub",
    },
    {
      label: "Ambient Noise Wall",
      value: "ambient-noise-wall",
    },
    {
      label: "Ambient Pop",
      value: "ambient-pop",
    },
    {
      label: "Art Pop",
      value: "art-pop",
    },
    {
      label: "Bachata",
      value: "bachata",
    },
    {
      label: "Ballad",
      value: "ballad",
    },
    {
      label: "Bassline",
      value: "bassline",
    },
    {
      label: "Batida",
      value: "batida",
    },
    {
      label: "Batucada",
      value: "batucada",
    },
    {
      label: "Bhajan",
      value: "bhajan",
    },
    {
      label: "Black Metal",
      value: "black-metal",
    },
    {
      label: "Blues",
      value: "blues",
    },
    {
      label: "Acoustic Blues",
      value: "acoustic-blues",
    },
    {
      label: "African Blues",
      value: "african-blues",
    },
    {
      label: "Blues Rock",
      value: "blues-rock",
    },
    {
      label: "Classic Blues",
      value: "classic-blues",
    },
    {
      label: "Country Blues",
      value: "country-blues",
    },
    {
      label: "Delta Blues",
      value: "delta-blues",
    },
    {
      label: "Modern Blues",
      value: "modern-blues",
    },
    {
      label: "Brass & Marching Band",
      value: "brass-marching-band",
    },
    {
      label: "Bagpipes",
      value: "bagpipes",
    },
    {
      label: "Military & Historical",
      value: "military-historical",
    },
    {
      label: "Oompah",
      value: "oompah",
    },
    {
      label: "Breakbeat",
      value: "breakbeat",
    },
    {
      label: "2-Step",
      value: "2-step",
    },
    {
      label: "Big Beat",
      value: "big-beat",
    },
    {
      label: "Drum and Bass",
      value: "drum-and-bass",
    },
    {
      label: "Dubstep",
      value: "dubstep",
    },
    {
      label: "Future Garage",
      value: "future-garage",
    },
    {
      label: "Jungle",
      value: "jungle",
    },
    {
      label: "Liquid Drum and Bass",
      value: "liquid-drum-and-bass",
    },
    {
      label: "Techstep",
      value: "techstep",
    },
    {
      label: "UK Garage",
      value: "uk-garage",
    },
    {
      label: "Bubblegum Pop",
      value: "bubblegum-pop",
    },
    {
      label: "Children’s Music",
      value: "childrens-music",
    },
    {
      label: "Lullabies",
      value: "lullabies",
    },
    {
      label: "Choral Symphony",
      value: "choral-symphony",
    },
    {
      label: "Christmas Music",
      value: "christmas-music",
    },
    {
      label: "Cinematic",
      value: "cinematic",
    },
    {
      label: "Action",
      value: "action",
    },
    {
      label: "Adventure",
      value: "adventure",
    },
    {
      label: "Beautiful",
      value: "beautiful",
    },
    {
      label: "Build",
      value: "build",
    },
    {
      label: "Chase",
      value: "chase",
    },
    {
      label: "Crime Scene",
      value: "crime-scene",
    },
    {
      label: "Drama",
      value: "drama",
    },
    {
      label: "Filmi",
      value: "filmi",
    },
    {
      label: "Horror",
      value: "horror",
    },
    {
      label: "Main Title",
      value: "main-title",
    },
    {
      label: "Mystery",
      value: "mystery",
    },
    {
      label: "Nostalgia",
      value: "nostalgia",
    },
    {
      label: "Pulses",
      value: "pulses",
    },
    {
      label: "Strange & Weird",
      value: "strange-weird",
    },
    {
      label: "Supernatural",
      value: "supernatural",
    },
    {
      label: "Suspense",
      value: "suspense",
    },
    {
      label: "Tragedy",
      value: "tragedy",
    },
    {
      label: "Circus & Funfair",
      value: "circus-funfair",
    },
    {
      label: "Amusement Park",
      value: "amusement-park",
    },
    {
      label: "City Pop",
      value: "city-pop",
    },
    {
      label: "Classic Rock",
      value: "classic-rock",
    },
    {
      label: "Choral",
      value: "choral",
    },
    {
      label: "Classical Crossover",
      value: "classical-crossover",
    },
    {
      label: "Contemporary Classical",
      value: "contemporary-classical",
    },
    {
      label: "Indian Classical",
      value: "indian-classical",
    },
    {
      label: "Orchestral",
      value: "orchestral",
    },
    {
      label: "Orchestral Hybrid",
      value: "orchestral-hybrid",
    },
    {
      label: "Small Ensemble",
      value: "small-ensemble",
    },
    {
      label: "Solo Instrumental",
      value: "solo-instrumental",
    },
    {
      label: "String Ensemble",
      value: "string-ensemble",
    },
    {
      label: "Waltz",
      value: "waltz",
    },
    {
      label: "Classical Period",
      value: "classical-period",
    },
    {
      label: "Cloud Rap",
      value: "cloud-rap",
    },
    {
      label: "Comedy",
      value: "comedy",
    },
    {
      label: "Bloopers",
      value: "bloopers",
    },
    {
      label: "Cartoons",
      value: "cartoons",
    },
    {
      label: "Sneaky",
      value: "sneaky",
    },
    {
      label: "Vaudeville",
      value: "vaudeville",
    },
    {
      label: "Complextro",
      value: "complextro",
    },
    {
      label: "Conscious Hip Hop",
      value: "conscious-hip-hop",
    },
    {
      label: "Contemporary Gospel",
      value: "contemporary-gospel",
    },
    {
      label: "Corporate",
      value: "corporate",
    },
    {
      label: "Americana",
      value: "americana",
    },
    {
      label: "Bluegrass",
      value: "bluegrass",
    },
    {
      label: "Contemporary Country",
      value: "contemporary-country",
    },
    {
      label: "Country Pop",
      value: "country-pop",
    },
    {
      label: "Country Rock",
      value: "country-rock",
    },
    {
      label: "Traditional Country",
      value: "traditional-country",
    },
    {
      label: "Western",
      value: "western",
    },
    {
      label: "Country Folk",
      value: "country-folk",
    },
    {
      label: "Country Rap",
      value: "country-rap",
    },
    {
      label: "Cumbia Mexicana",
      value: "cumbia-mexicana",
    },
    {
      label: "Cumbia Norteña Mexicana",
      value: "cumbia-nortena-mexicana",
    },
    {
      label: "Cumbia Pop",
      value: "cumbia-pop",
    },
    {
      label: "Dance",
      value: "dance",
    },
    {
      label: "Dancefloor Drum and Bass",
      value: "dancefloor-drum-and-bass",
    },
    {
      label: "Dansband",
      value: "dansband",
    },
    {
      label: "Dark Ambient",
      value: "dark-ambient",
    },
    {
      label: "Dark Cabaret",
      value: "dark-cabaret",
    },
    {
      label: "Dark Electro",
      value: "dark-electro",
    },
    {
      label: "Darksynth",
      value: "darksynth",
    },
    {
      label: "Dembow",
      value: "dembow",
    },
    {
      label: "Disco",
      value: "disco",
    },
    {
      label: "Boogie",
      value: "boogie",
    },
    {
      label: "Nu Disco",
      value: "nu-disco",
    },
    {
      label: "Dixieland",
      value: "dixieland",
    },
    {
      label: "Downtempo",
      value: "downtempo",
    },
    {
      label: "Balearic Beat",
      value: "balearic-beat",
    },
    {
      label: "Chillout",
      value: "chillout",
    },
    {
      label: "Chillstep",
      value: "chillstep",
    },
    {
      label: "Chillwave",
      value: "chillwave",
    },
    {
      label: "Trip Hop",
      value: "trip-hop",
    },
    {
      label: "Easy Listening",
      value: "easy-listening",
    },
    {
      label: "Lounge",
      value: "lounge",
    },
    {
      label: "Electro Latino",
      value: "electro-latino",
    },
    {
      label: "Electro-Funk",
      value: "electro-funk",
    },
    {
      label: "Electroacoustic",
      value: "electroacoustic",
    },
    {
      label: "Bit Music",
      value: "bit-music",
    },
    {
      label: "Dark Wave",
      value: "dark-wave",
    },
    {
      label: "Electro",
      value: "electro",
    },
    {
      label: "Electro Swing",
      value: "electro-swing",
    },
    {
      label: "Electronic Dance Music (EDM)",
      value: "edm",
    },
    {
      label: "Eurodance",
      value: "eurodance",
    },
    {
      label: "Footwork",
      value: "footwork",
    },
    {
      label: "Future Bass",
      value: "future-bass",
    },
    {
      label: "Hardstyle",
      value: "hardstyle",
    },
    {
      label: "IDM",
      value: "idm",
    },
    {
      label: "Indietronica",
      value: "indietronica",
    },
    {
      label: "Jersey Club",
      value: "jersey-club",
    },
    {
      label: "Melodic Techno",
      value: "melodic-techno",
    },
    {
      label: "Midtempo Bass",
      value: "midtempo-bass",
    },
    {
      label: "Minimal Techno",
      value: "minimal-techno",
    },
    {
      label: "Psytrance",
      value: "psytrance",
    },
    {
      label: "Synthwave",
      value: "synthwave",
    },
    {
      label: "Techno",
      value: "techno",
    },
    {
      label: "Trance",
      value: "trance",
    },
    {
      label: "Trap EDM",
      value: "trap-edm",
    },
    {
      label: "Vaporwave",
      value: "vaporwave",
    },
    {
      label: "Electronica",
      value: "electronica",
    },
    {
      label: "Euro House",
      value: "euro-house",
    },
    {
      label: "Euro-Trance",
      value: "euro-trance",
    },
    {
      label: "Experimental",
      value: "experimental",
    },
    {
      label: "Experimental Electronic",
      value: "experimental-electronic",
    },
    {
      label: "Experimental Hip Hop",
      value: "experimental-hip-hop",
    },
    {
      label: "Fanfares",
      value: "fanfares",
    },
    {
      label: "Ceremonial & Olympic",
      value: "ceremonial-olympic",
    },
    {
      label: "Folk",
      value: "folk",
    },
    {
      label: "Alternative Folk",
      value: "alternative-folk",
    },
    {
      label: "Celtic",
      value: "celtic",
    },
    {
      label: "Contemporary Folk",
      value: "contemporary-folk",
    },
    {
      label: "Folk Pop",
      value: "folk-pop",
    },
    {
      label: "Indie Folk",
      value: "indie-folk",
    },
    {
      label: "Irish Folk",
      value: "irish-folk",
    },
    {
      label: "Klezmer",
      value: "klezmer",
    },
    {
      label: "Polka",
      value: "polka",
    },
    {
      label: "Folktronica",
      value: "folktronica",
    },
    {
      label: "Forró",
      value: "forro",
    },
    {
      label: "Afro-Funk",
      value: "afro-funk",
    },
    {
      label: "Funk Rock",
      value: "funk-rock",
    },
    {
      label: "Synth Funk",
      value: "synth-funk",
    },
    {
      label: "Funktronica",
      value: "funktronica",
    },
    {
      label: "Garage House",
      value: "garage-house",
    },
    {
      label: "Glam Rock",
      value: "glam-rock",
    },
    {
      label: "Gqom",
      value: "gqom",
    },
    {
      label: "Hands Up",
      value: "hands-up",
    },
    {
      label: "Hard House",
      value: "hard-house",
    },
    {
      label: "Hard Trance",
      value: "hard-trance",
    },
    {
      label: "Hard Trap",
      value: "hard-trap",
    },
    {
      label: "Hardcore Hip Hop",
      value: "hardcore-hip-hop",
    },
    {
      label: "Hardcore Punk",
      value: "hardcore-punk",
    },
    {
      label: "Hindustani Classical",
      value: "hindustani-classical",
    },
    {
      label: "Alternative Hip Hop",
      value: "alternative-hip-hop",
    },
    {
      label: "Boom Bap",
      value: "boom-bap",
    },
    {
      label: "Bounce",
      value: "bounce",
    },
    {
      label: "Detroit Trap",
      value: "detroit-trap",
    },
    {
      label: "Drift Phonk",
      value: "drift-phonk",
    },
    {
      label: "Drill",
      value: "drill",
    },
    {
      label: "East Coast Hip Hop",
      value: "east-coast-hip-hop",
    },
    {
      label: "Grime",
      value: "grime",
    },
    {
      label: "Lo-Fi Hip Hop",
      value: "lo-fi-hip-hop",
    },
    {
      label: "Old School Hip Hop",
      value: "old-school-hip-hop",
    },
    {
      label: "Trap",
      value: "trap",
    },
    {
      label: "UK Hip Hop",
      value: "uk-hip-hop",
    },
    {
      label: "West Coast Hip Hop",
      value: "west-coast-hip-hop",
    },
    {
      label: "Hip Hop Soul",
      value: "hip-hop-soul",
    },
    {
      label: "Horrorcore",
      value: "horrorcore",
    },
    {
      label: "House",
      value: "house",
    },
    {
      label: "Afro House",
      value: "afro-house",
    },
    {
      label: "Amapiano",
      value: "amapiano",
    },
    {
      label: "Ambient House",
      value: "ambient-house",
    },
    {
      label: "Bass House",
      value: "bass-house",
    },
    {
      label: "Big Room House",
      value: "big-room-house",
    },
    {
      label: "Deep House",
      value: "deep-house",
    },
    {
      label: "Electro House",
      value: "electro-house",
    },
    {
      label: "Funky House",
      value: "funky-house",
    },
    {
      label: "Future Funk",
      value: "future-funk",
    },
    {
      label: "Future House",
      value: "future-house",
    },
    {
      label: "Hip House",
      value: "hip-house",
    },
    {
      label: "Lo-Fi House",
      value: "lo-fi-house",
    },
    {
      label: "Microhouse",
      value: "microhouse",
    },
    {
      label: "Organic House",
      value: "organic-house",
    },
    {
      label: "Progressive House",
      value: "progressive-house",
    },
    {
      label: "Slap House",
      value: "slap-house",
    },
    {
      label: "Soft House",
      value: "soft-house",
    },
    {
      label: "Tech House",
      value: "tech-house",
    },
    {
      label: "Tribal House",
      value: "tribal-house",
    },
    {
      label: "Tropical House",
      value: "tropical-house",
    },
    {
      label: "Huapango",
      value: "huapango",
    },
    {
      label: "Hybrid Trap",
      value: "hybrid-trap",
    },
    {
      label: "Indian Pop",
      value: "indian-pop",
    },
    {
      label: "Indie Surf",
      value: "indie-surf",
    },
    {
      label: "Industrial Metal",
      value: "industrial-metal",
    },
    {
      label: "Industrial Rock",
      value: "industrial-rock",
    },
    {
      label: "Instrumental Rock",
      value: "instrumental-rock",
    },
    {
      label: "Iraqi Maqam",
      value: "iraqi-maqam",
    },
    {
      label: "J-Pop",
      value: "j-pop",
    },
    {
      label: "J-Rock",
      value: "j-rock",
    },
    {
      label: "Japanese Classical",
      value: "japanese-classical",
    },
    {
      label: "Acid Jazz",
      value: "acid-jazz",
    },
    {
      label: "Bebop",
      value: "bebop",
    },
    {
      label: "Big Band",
      value: "big-band",
    },
    {
      label: "Classic Jazz",
      value: "classic-jazz",
    },
    {
      label: "Contemporary Jazz",
      value: "contemporary-jazz",
    },
    {
      label: "Cool Jazz",
      value: "cool-jazz",
    },
    {
      label: "Dark Jazz",
      value: "dark-jazz",
    },
    {
      label: "Jazz Fusion",
      value: "jazz-fusion",
    },
    {
      label: "Jazz-Funk",
      value: "jazz-funk",
    },
    {
      label: "Latin Jazz",
      value: "latin-jazz",
    },
    {
      label: "Ragtime",
      value: "ragtime",
    },
    {
      label: "Smooth Jazz",
      value: "smooth-jazz",
    },
    {
      label: "Swing",
      value: "swing",
    },
    {
      label: "Jazz Blues",
      value: "jazz-blues",
    },
    {
      label: "Jazz Pop",
      value: "jazz-pop",
    },
    {
      label: "Korean Ballad",
      value: "korean-ballad",
    },
    {
      label: "Korean Classical",
      value: "korean-classical",
    },
    {
      label: "Latin",
      value: "latin",
    },
    {
      label: "Bolero",
      value: "bolero",
    },
    {
      label: "Bossa Nova",
      value: "bossa-nova",
    },
    {
      label: "Calypso",
      value: "calypso",
    },
    {
      label: "Chachachá",
      value: "chachacha",
    },
    {
      label: "Corrido",
      value: "corrido",
    },
    {
      label: "Corrido Tumbado",
      value: "corrido-tumbado",
    },
    {
      label: "Cumbia",
      value: "cumbia",
    },
    {
      label: "Flamenco",
      value: "flamenco",
    },
    {
      label: "Funk Carioca",
      value: "funk-carioca",
    },
    {
      label: "Guaracha Edm",
      value: "guaracha-edm",
    },
    {
      label: "Latin Pop",
      value: "latin-pop",
    },
    {
      label: "Mambo",
      value: "mambo",
    },
    {
      label: "Mariachi",
      value: "mariachi",
    },
    {
      label: "Merengue",
      value: "merengue",
    },
    {
      label: "Reggaeton",
      value: "reggaeton",
    },
    {
      label: "Rumba",
      value: "rumba",
    },
    {
      label: "Salsa",
      value: "salsa",
    },
    {
      label: "Samba",
      value: "samba",
    },
    {
      label: "Son Cubano",
      value: "son-cubano",
    },
    {
      label: "Tango",
      value: "tango",
    },
    {
      label: "Latin Ballad",
      value: "latin-ballad",
    },
    {
      label: "Latin House",
      value: "latin-house",
    },
    {
      label: "Latin Rock",
      value: "latin-rock",
    },
    {
      label: "Lo-Fi",
      value: "lo-fi",
    },
    {
      label: "Marching Band",
      value: "marching-band",
    },
    {
      label: "Mbalax",
      value: "mbalax",
    },
    {
      label: "Medieval",
      value: "medieval",
    },
    {
      label: "Metal",
      value: "metal",
    },
    {
      label: "Heavy Metal",
      value: "heavy-metal",
    },
    {
      label: "Thrash Metal",
      value: "thrash-metal",
    },
    {
      label: "Metalcore",
      value: "metalcore",
    },
    {
      label: "Miami Bass",
      value: "miami-bass",
    },
    {
      label: "Min’yō",
      value: "minyo",
    },
    {
      label: "Minimalism",
      value: "minimalism",
    },
    {
      label: "MPB",
      value: "mpb",
    },
    {
      label: "Nature Sounds",
      value: "nature-sounds",
    },
    {
      label: "Neo-Psychedelia",
      value: "neo-psychedelia",
    },
    {
      label: "Neoclassical Dark Wave",
      value: "neoclassical-dark-wave",
    },
    {
      label: "Neoclassical New Age",
      value: "neoclassical-new-age",
    },
    {
      label: "Neoclassicism",
      value: "neoclassicism",
    },
    {
      label: "Norteño",
      value: "norteno",
    },
    {
      label: "Nu Jazz",
      value: "nu-jazz",
    },
    {
      label: "Nu Metal",
      value: "nu-metal",
    },
    {
      label: "Opera",
      value: "opera",
    },
    {
      label: "Orchestral Jazz",
      value: "orchestral-jazz",
    },
    {
      label: "Peak Time Techno",
      value: "peak-time-techno",
    },
    {
      label: "Phonk",
      value: "phonk",
    },
    {
      label: "Afrobeats",
      value: "afrobeats",
    },
    {
      label: "Alternative Pop",
      value: "alternative-pop",
    },
    {
      label: "Bedroom Pop",
      value: "bedroom-pop",
    },
    {
      label: "Contemporary Christian",
      value: "contemporary-christian",
    },
    {
      label: "Dance-Pop",
      value: "dance-pop",
    },
    {
      label: "Dream Pop",
      value: "dream-pop",
    },
    {
      label: "Electropop",
      value: "electropop",
    },
    {
      label: "Europop",
      value: "europop",
    },
    {
      label: "Hyperpop",
      value: "hyperpop",
    },
    {
      label: "Indie Pop",
      value: "indie-pop",
    },
    {
      label: "K-pop",
      value: "k-pop",
    },
    {
      label: "Pop Rock",
      value: "pop-rock",
    },
    {
      label: "Schlager",
      value: "schlager",
    },
    {
      label: "Synth Pop",
      value: "synth-pop",
    },
    {
      label: "Teen Pop",
      value: "teen-pop",
    },
    {
      label: "Pop Soul",
      value: "pop-soul",
    },
    {
      label: "Post-Classical",
      value: "post-classical",
    },
    {
      label: "Post-Punk",
      value: "post-punk",
    },
    {
      label: "Post-Punk Revival",
      value: "post-punk-revival",
    },
    {
      label: "Praise & Worship",
      value: "praise-worship",
    },
    {
      label: "Progressive Breaks",
      value: "progressive-breaks",
    },
    {
      label: "Progressive Electronic",
      value: "progressive-electronic",
    },
    {
      label: "Psychedelic",
      value: "psychedelic",
    },
    {
      label: "Psychedelic Pop",
      value: "psychedelic-pop",
    },
    {
      label: "Psychedelic Soul",
      value: "psychedelic-soul",
    },
    {
      label: "Punk",
      value: "punk",
    },
    {
      label: "Pop Punk",
      value: "pop-punk",
    },
    {
      label: "Punk Rock",
      value: "punk-rock",
    },
    {
      label: "Contemporary R&B",
      value: "contemporary-rb",
    },
    {
      label: "Motown",
      value: "motown",
    },
    {
      label: "Ranchera",
      value: "ranchera",
    },
    {
      label: "Reggae",
      value: "reggae",
    },
    {
      label: "Dancehall",
      value: "dancehall",
    },
    {
      label: "Dub",
      value: "dub",
    },
    {
      label: "Ska",
      value: "ska",
    },
    {
      label: "Regional Mexicano",
      value: "regional-mexicano",
    },
    {
      label: "Religious Music",
      value: "religious-music",
    },
    {
      label: "Modern Hymns",
      value: "modern-hymns",
    },
    {
      label: "Requiem",
      value: "requiem",
    },
    {
      label: "Alternative Rock",
      value: "alternative-rock",
    },
    {
      label: "Arena Rock",
      value: "arena-rock",
    },
    {
      label: "Electronic Rock",
      value: "electronic-rock",
    },
    {
      label: "Folk Rock",
      value: "folk-rock",
    },
    {
      label: "Garage Rock",
      value: "garage-rock",
    },
    {
      label: "Grunge",
      value: "grunge",
    },
    {
      label: "Hard Rock",
      value: "hard-rock",
    },
    {
      label: "Indie Rock",
      value: "indie-rock",
    },
    {
      label: "Post Rock",
      value: "post-rock",
    },
    {
      label: "Psychedelic Rock",
      value: "psychedelic-rock",
    },
    {
      label: "Rock and roll",
      value: "rock-and-roll",
    },
    {
      label: "Rockabilly",
      value: "rockabilly",
    },
    {
      label: "Roots Rock",
      value: "roots-rock",
    },
    {
      label: "Soft Rock",
      value: "soft-rock",
    },
    {
      label: "Surf Rock",
      value: "surf-rock",
    },
    {
      label: "Romantic Classical",
      value: "romantic-classical",
    },
    {
      label: "Sambass",
      value: "sambass",
    },
    {
      label: "Screamo",
      value: "screamo",
    },
    {
      label: "Shoegaze",
      value: "shoegaze",
    },
    {
      label: "Singer-Songwriter",
      value: "singer-songwriter",
    },
    {
      label: "Slack-Key Guitar",
      value: "slack-key-guitar",
    },
    {
      label: "Smooth Soul",
      value: "smooth-soul",
    },
    {
      label: "Son Jarocho",
      value: "son-jarocho",
    },
    {
      label: "Gospel",
      value: "gospel",
    },
    {
      label: "Neo Soul",
      value: "neo-soul",
    },
    {
      label: "Soul Blues",
      value: "soul-blues",
    },
    {
      label: "Soul Jazz",
      value: "soul-jazz",
    },
    {
      label: "Sound Collage",
      value: "sound-collage",
    },
    {
      label: "Southeast Asian Classical",
      value: "southeast-asian-classical",
    },
    {
      label: "Southern Hip Hop",
      value: "southern-hip-hop",
    },
    {
      label: "Southern Rock",
      value: "southern-rock",
    },
    {
      label: "Space Age Pop",
      value: "space-age-pop",
    },
    {
      label: "Space Ambient",
      value: "space-ambient",
    },
    {
      label: "Special Occasions",
      value: "special-occasions",
    },
    {
      label: "Birthdays",
      value: "birthdays",
    },
    {
      label: "Christmas",
      value: "christmas",
    },
    {
      label: "Drinking Songs",
      value: "drinking-songs",
    },
    {
      label: "Funerals",
      value: "funerals",
    },
    {
      label: "Weddings",
      value: "weddings",
    },
    {
      label: "Speed Garage",
      value: "speed-garage",
    },
    {
      label: "Speed House",
      value: "speed-house",
    },
    {
      label: "Stoner Rock",
      value: "stoner-rock",
    },
    {
      label: "Sunshine Pop",
      value: "sunshine-pop",
    },
    {
      label: "Swing Revival",
      value: "swing-revival",
    },
    {
      label: "Symphonic Poem",
      value: "symphonic-poem",
    },
    {
      label: "Tech Trance",
      value: "tech-trance",
    },
    {
      label: "Techno Bass",
      value: "techno-bass",
    },
    {
      label: "Trap Metal",
      value: "trap-metal",
    },
    {
      label: "UK Drill",
      value: "uk-drill",
    },
    {
      label: "UK Funky",
      value: "uk-funky",
    },
    {
      label: "Underground Hip Hop",
      value: "underground-hip-hop",
    },
    {
      label: "Vocal Jazz",
      value: "vocal-jazz",
    },
    {
      label: "Vocal Trance",
      value: "vocal-trance",
    },
    {
      label: "World Fusion",
      value: "world-fusion",
    },
  ],
  moods: [
    {
      label: "Happy",
      value: "happy",
    },
    {
      label: "Dreamy",
      value: "dreamy",
    },
    {
      label: "Epic",
      value: "epic",
    },
    {
      label: "Laid Back",
      value: "laid-back",
    },
    {
      label: "Euphoric",
      value: "euphoric",
    },
    {
      label: "Quirky",
      value: "quirky",
    },
    {
      label: "Suspense",
      value: "suspense",
    },
    {
      label: "Running",
      value: "running",
    },
    {
      label: "Relaxing",
      value: "relaxing",
    },
    {
      label: "Mysterious",
      value: "mysterious",
    },
    {
      label: "Sentimental",
      value: "sentimental",
    },
    {
      label: "Sad",
      value: "sad",
    },
    {
      label: "Angry",
      value: "angry",
    },
    {
      label: "Busy & Frantic",
      value: "busy-frantic",
    },
    {
      label: "Changing Tempo",
      value: "changing-tempo",
    },
    {
      label: "Chasing",
      value: "chasing",
    },
    {
      label: "Dark",
      value: "dark",
    },
    {
      label: "Eccentric",
      value: "eccentric",
    },
    {
      label: "Elegant",
      value: "elegant",
    },
    {
      label: "Fear",
      value: "fear",
    },
    {
      label: "Floating",
      value: "floating",
    },
    {
      label: "Funny",
      value: "funny",
    },
    {
      label: "Glamorous",
      value: "glamorous",
    },
    {
      label: "Heavy & Ponderous",
      value: "heavy-ponderous",
    },
    {
      label: "Hopeful",
      value: "hopeful",
    },
    {
      label: "Marching",
      value: "marching",
    },
    {
      label: "Peaceful",
      value: "peaceful",
    },
    {
      label: "Restless",
      value: "restless",
    },
    {
      label: "Romantic",
      value: "romantic",
    },
    {
      label: "Scary",
      value: "scary",
    },
    {
      label: "Sexy",
      value: "sexy",
    },
    {
      label: "Smooth",
      value: "smooth",
    },
    {
      label: "Sneaking",
      value: "sneaking",
    },
    {
      label: "Weird",
      value: "weird",
    },
  ],
  instruments: [
    {
      value: "acoustic-guitar",
      label: "Acoustic guitar",
    },
    {
      value: "accordion",
      label: "Accordion",
    },
    {
      value: "electronic-drums",
      label: "Electronic drums",
    },
  ],
  musicalKeys: [
    {
      label: "C major",
      value: "c-major",
    },
    {
      label: "D♭ major",
      value: "db-major",
    },
    {
      label: "D major",
      value: "d-major",
    },
    {
      label: "E♭ major",
      value: "eb-major",
    },
    {
      label: "E major",
      value: "e-major",
    },
    {
      label: "F major",
      value: "f-major",
    },
    {
      label: "F♯ major",
      value: "fs-major",
    },
    {
      label: "G major",
      value: "g-major",
    },
    {
      label: "A♭ major",
      value: "ab-major",
    },
    {
      label: "A major",
      value: "a-major",
    },
    {
      label: "B♭ major",
      value: "bb-major",
    },
    {
      label: "B major",
      value: "b-major",
    },
    {
      label: "C minor",
      value: "c-minor",
    },
    {
      label: "C♯ minor",
      value: "cs-minor",
    },
    {
      label: "D minor",
      value: "d-minor",
    },
    {
      label: "D♯ minor",
      value: "ds-minor",
    },
    {
      label: "E minor",
      value: "e-minor",
    },
    {
      label: "F minor",
      value: "f-minor",
    },
    {
      label: "F♯ minor",
      value: "fs-minor",
    },
    {
      label: "G minor",
      value: "g-minor",
    },
    {
      label: "G♯ minor",
      value: "gs-minor",
    },
    {
      label: "A minor",
      value: "a-minor",
    },
    {
      label: "B♭ minor",
      value: "bb-minor",
    },
    {
      label: "B minor",
      value: "b-minor",
    },
  ],
  decades: [
    {
      label: "1950s",
      value: "1950s",
    },
    {
      label: "1960s",
      value: "1960s",
    },
    {
      label: "1970s",
      value: "1970s",
    },
    {
      label: "1980s",
      value: "1980s",
    },
    {
      label: "1990s",
      value: "1990s",
    },
    {
      label: "2000s",
      value: "2000s",
    },
    {
      label: "2010s",
      value: "2010s",
    },
    {
      label: "2020s",
      value: "2020s",
    },
  ],
  countries: [
    {
      label: "African continent",
      value: "african-continent",
    },
    {
      label: "Australia",
      value: "australia",
    },
    {
      label: "Cuba",
      value: "cuba",
    },
    {
      label: "France",
      value: "france",
    },
  ],
  soundEffects: [
    {
      value: "ambience",
      label: "Ambience",
    },
    {
      value: "rain",
      label: "Rain",
    },
    {
      value: "wind",
      label: "Wind",
    },
    {
      value: "swooshes",
      label: "Swooshes",
    },
    {
      value: "water",
      label: "Water",
    },
    {
      value: "vehicles",
      label: "Vehicles",
    },
    {
      value: "swooshes--whoosh",
      label: "Swooshes / Whoosh",
    },
    {
      value: "cartoon",
      label: "Cartoon",
    },
    {
      value: "user-interface",
      label: "User Interface",
    },
    {
      value: "designed--riser",
      label: "Designed / Riser",
    },
    {
      value: "computers",
      label: "Computers",
    },
    {
      value: "objects",
      label: "Objects",
    },
    {
      value: "voices",
      label: "Voices",
    },
    {
      value: "designed",
      label: "Designed",
    },
    {
      value: "air",
      label: "Air",
    },
    {
      value: "air--blow",
      label: "Air / Blow",
    },
    {
      value: "air--burst",
      label: "Air / Burst",
    },
    {
      value: "air--hiss",
      label: "Air / Hiss",
    },
    {
      value: "air--misc",
      label: "Air / Misc",
    },
    {
      value: "air--suction",
      label: "Air / Suction",
    },
    {
      value: "aircraft",
      label: "Aircraft",
    },
    {
      value: "aircraft--helicopter",
      label: "Aircraft / Helicopter",
    },
    {
      value: "aircraft--interior",
      label: "Aircraft / Interior",
    },
    {
      value: "aircraft--jet",
      label: "Aircraft / Jet",
    },
    {
      value: "aircraft--military",
      label: "Aircraft / Military",
    },
    {
      value: "aircraft--misc",
      label: "Aircraft / Misc",
    },
    {
      value: "aircraft--prop",
      label: "Aircraft / Prop",
    },
    {
      value: "aircraft--radio-controlled",
      label: "Aircraft / Radio Controlled",
    },
    {
      value: "aircraft--rocket",
      label: "Aircraft / Rocket",
    },
    {
      value: "alarms",
      label: "Alarms",
    },
    {
      value: "alarms--bell",
      label: "Alarms / Bell",
    },
    {
      value: "alarms--buzzer",
      label: "Alarms / Buzzer",
    },
    {
      value: "alarms--clock",
      label: "Alarms / Clock",
    },
    {
      value: "alarms--electronic",
      label: "Alarms / Electronic",
    },
    {
      value: "alarms--misc",
      label: "Alarms / Misc",
    },
    {
      value: "alarms--siren",
      label: "Alarms / Siren",
    },
    {
      value: "ambience--air",
      label: "Ambience / Air",
    },
    {
      value: "ambience--alpine",
      label: "Ambience / Alpine",
    },
    {
      value: "ambience--amusement",
      label: "Ambience / Amusement",
    },
    {
      value: "ambience--birdsong",
      label: "Ambience / Birdsong",
    },
    {
      value: "ambience--celebration",
      label: "Ambience / Celebration",
    },
    {
      value: "ambience--construction",
      label: "Ambience / Construction",
    },
    {
      value: "ambience--desert",
      label: "Ambience / Desert",
    },
    {
      value: "ambience--designed",
      label: "Ambience / Designed",
    },
    {
      value: "ambience--emergency",
      label: "Ambience / Emergency",
    },
    {
      value: "ambience--fantasy",
      label: "Ambience / Fantasy",
    },
    {
      value: "ambience--farm",
      label: "Ambience / Farm",
    },
    {
      value: "ambience--forest",
      label: "Ambience / Forest",
    },
    {
      value: "ambience--grassland",
      label: "Ambience / Grassland",
    },
    {
      value: "ambience--historical",
      label: "Ambience / Historical",
    },
    {
      value: "ambience--hitech",
      label: "Ambience / Hitech",
    },
    {
      value: "ambience--hospital",
      label: "Ambience / Hospital",
    },
    {
      value: "ambience--industrial",
      label: "Ambience / Industrial",
    },
    {
      value: "ambience--insect",
      label: "Ambience / Insect",
    },
    {
      value: "ambience--lakeside",
      label: "Ambience / Lakeside",
    },
    {
      value: "ambience--market",
      label: "Ambience / Market",
    },
    {
      value: "ambience--misc",
      label: "Ambience / Misc",
    },
    {
      value: "ambience--nautical",
      label: "Ambience / Nautical",
    },
    {
      value: "ambience--office",
      label: "Ambience / Office",
    },
    {
      value: "ambience--park",
      label: "Ambience / Park",
    },
    {
      value: "ambience--prison",
      label: "Ambience / Prison",
    },
    {
      value: "ambience--protest",
      label: "Ambience / Protest",
    },
    {
      value: "ambience--public-place",
      label: "Ambience / Public Place",
    },
    {
      value: "ambience--religious",
      label: "Ambience / Religious",
    },
    {
      value: "ambience--residential",
      label: "Ambience / Residential",
    },
    {
      value: "ambience--restaurant-bar",
      label: "Ambience / Restaurant & Bar",
    },
    {
      value: "ambience--room-tone",
      label: "Ambience / Room Tone",
    },
    {
      value: "ambience--rural",
      label: "Ambience / Rural",
    },
    {
      value: "ambience--school",
      label: "Ambience / School",
    },
    {
      value: "ambience--scifi",
      label: "Ambience / Scifi",
    },
    {
      value: "ambience--seaside",
      label: "Ambience / Seaside",
    },
    {
      value: "ambience--sport",
      label: "Ambience / Sport",
    },
    {
      value: "ambience--suburban",
      label: "Ambience / Suburban",
    },
    {
      value: "ambience--swamp",
      label: "Ambience / Swamp",
    },
    {
      value: "ambience--town",
      label: "Ambience / Town",
    },
    {
      value: "ambience--traffic",
      label: "Ambience / Traffic",
    },
    {
      value: "ambience--transportation",
      label: "Ambience / Transportation",
    },
    {
      value: "ambience--tropical",
      label: "Ambience / Tropical",
    },
    {
      value: "ambience--tundra",
      label: "Ambience / Tundra",
    },
    {
      value: "ambience--underground",
      label: "Ambience / Underground",
    },
    {
      value: "ambience--underwater",
      label: "Ambience / Underwater",
    },
    {
      value: "ambience--urban",
      label: "Ambience / Urban",
    },
    {
      value: "ambience--warfare",
      label: "Ambience / Warfare",
    },
    {
      value: "animals",
      label: "Animals",
    },
    {
      value: "animals--amphibian",
      label: "Animals / Amphibian",
    },
    {
      value: "animals--aquatic",
      label: "Animals / Aquatic",
    },
    {
      value: "animals--bat",
      label: "Animals / Bat",
    },
    {
      value: "animals--cat-domestic",
      label: "Animals / Cat Domestic",
    },
    {
      value: "animals--cat-wild",
      label: "Animals / Cat Wild",
    },
    {
      value: "animals--dog",
      label: "Animals / Dog",
    },
    {
      value: "animals--dog-wild",
      label: "Animals / Dog Wild",
    },
    {
      value: "animals--farm",
      label: "Animals / Farm",
    },
    {
      value: "animals--horse",
      label: "Animals / Horse",
    },
    {
      value: "animals--insect",
      label: "Animals / Insect",
    },
    {
      value: "animals--misc",
      label: "Animals / Misc",
    },
    {
      value: "animals--primate",
      label: "Animals / Primate",
    },
    {
      value: "animals--reptile",
      label: "Animals / Reptile",
    },
    {
      value: "animals--rodent",
      label: "Animals / Rodent",
    },
    {
      value: "animals--wild",
      label: "Animals / Wild",
    },
    {
      value: "archived",
      label: "Archived",
    },
    {
      value: "archived--impulse-response",
      label: "Archived / Impulse Response",
    },
    {
      value: "archived--test-tone",
      label: "Archived / Test Tone",
    },
    {
      value: "archived--wtf",
      label: "Archived / Wtf",
    },
    {
      value: "beeps",
      label: "Beeps",
    },
    {
      value: "beeps--appliance",
      label: "Beeps / Appliance",
    },
    {
      value: "beeps--general",
      label: "Beeps / General",
    },
    {
      value: "beeps--lofi",
      label: "Beeps / Lofi",
    },
    {
      value: "beeps--medical",
      label: "Beeps / Medical",
    },
    {
      value: "beeps--timer",
      label: "Beeps / Timer",
    },
    {
      value: "beeps--vehicle",
      label: "Beeps / Vehicle",
    },
    {
      value: "bells",
      label: "Bells",
    },
    {
      value: "bells--animal",
      label: "Bells / Animal",
    },
    {
      value: "bells--doorbell",
      label: "Bells / Doorbell",
    },
    {
      value: "bells--gong",
      label: "Bells / Gong",
    },
    {
      value: "bells--handbell",
      label: "Bells / Handbell",
    },
    {
      value: "bells--large",
      label: "Bells / Large",
    },
    {
      value: "bells--misc",
      label: "Bells / Misc",
    },
    {
      value: "birds",
      label: "Birds",
    },
    {
      value: "birds--bird-of-prey",
      label: "Birds / Bird Of Prey",
    },
    {
      value: "birds--crow",
      label: "Birds / Crow",
    },
    {
      value: "birds--fowl",
      label: "Birds / Fowl",
    },
    {
      value: "birds--misc",
      label: "Birds / Misc",
    },
    {
      value: "birds--sea",
      label: "Birds / Sea",
    },
    {
      value: "birds--songbird",
      label: "Birds / Songbird",
    },
    {
      value: "birds--tropical",
      label: "Birds / Tropical",
    },
    {
      value: "birds--wading",
      label: "Birds / Wading",
    },
    {
      value: "boats",
      label: "Boats",
    },
    {
      value: "boats--air-boat",
      label: "Boats / Air Boat",
    },
    {
      value: "boats--bow-wash",
      label: "Boats / Bow Wash",
    },
    {
      value: "boats--door",
      label: "Boats / Door",
    },
    {
      value: "boats--fishing",
      label: "Boats / Fishing",
    },
    {
      value: "boats--horn",
      label: "Boats / Horn",
    },
    {
      value: "boats--interior",
      label: "Boats / Interior",
    },
    {
      value: "boats--mechanism",
      label: "Boats / Mechanism",
    },
    {
      value: "boats--misc",
      label: "Boats / Misc",
    },
    {
      value: "boats--motorboat",
      label: "Boats / Motorboat",
    },
    {
      value: "boats--racing",
      label: "Boats / Racing",
    },
    {
      value: "boats--rowboat",
      label: "Boats / Rowboat",
    },
    {
      value: "boats--sailboat",
      label: "Boats / Sailboat",
    },
    {
      value: "boats--ship",
      label: "Boats / Ship",
    },
    {
      value: "boats--steam",
      label: "Boats / Steam",
    },
    {
      value: "boats--submarine",
      label: "Boats / Submarine",
    },
    {
      value: "boats--underwater",
      label: "Boats / Underwater",
    },
    {
      value: "bullets",
      label: "Bullets",
    },
    {
      value: "bullets--by",
      label: "Bullets / By",
    },
    {
      value: "bullets--impact",
      label: "Bullets / Impact",
    },
    {
      value: "bullets--misc",
      label: "Bullets / Misc",
    },
    {
      value: "bullets--ricochet",
      label: "Bullets / Ricochet",
    },
    {
      value: "bullets--shell",
      label: "Bullets / Shell",
    },
    {
      value: "cartoon--animal",
      label: "Cartoon / Animal",
    },
    {
      value: "cartoon--boing",
      label: "Cartoon / Boing",
    },
    {
      value: "cartoon--creak",
      label: "Cartoon / Creak",
    },
    {
      value: "cartoon--horn",
      label: "Cartoon / Horn",
    },
    {
      value: "cartoon--impact",
      label: "Cartoon / Impact",
    },
    {
      value: "cartoon--machine",
      label: "Cartoon / Machine",
    },
    {
      value: "cartoon--misc",
      label: "Cartoon / Misc",
    },
    {
      value: "cartoon--musical",
      label: "Cartoon / Musical",
    },
    {
      value: "cartoon--pluck",
      label: "Cartoon / Pluck",
    },
    {
      value: "cartoon--pop",
      label: "Cartoon / Pop",
    },
    {
      value: "cartoon--shake",
      label: "Cartoon / Shake",
    },
    {
      value: "cartoon--splat",
      label: "Cartoon / Splat",
    },
    {
      value: "cartoon--squeak",
      label: "Cartoon / Squeak",
    },
    {
      value: "cartoon--stretch",
      label: "Cartoon / Stretch",
    },
    {
      value: "cartoon--swish",
      label: "Cartoon / Swish",
    },
    {
      value: "cartoon--twang",
      label: "Cartoon / Twang",
    },
    {
      value: "cartoon--vehicle",
      label: "Cartoon / Vehicle",
    },
    {
      value: "cartoon--vocal",
      label: "Cartoon / Vocal",
    },
    {
      value: "cartoon--warble",
      label: "Cartoon / Warble",
    },
    {
      value: "cartoon--whistle",
      label: "Cartoon / Whistle",
    },
    {
      value: "ceramics",
      label: "Ceramics",
    },
    {
      value: "ceramics--break",
      label: "Ceramics / Break",
    },
    {
      value: "ceramics--crash-debris",
      label: "Ceramics / Crash & Debris",
    },
    {
      value: "ceramics--friction",
      label: "Ceramics / Friction",
    },
    {
      value: "ceramics--handle",
      label: "Ceramics / Handle",
    },
    {
      value: "ceramics--impact",
      label: "Ceramics / Impact",
    },
    {
      value: "ceramics--movement",
      label: "Ceramics / Movement",
    },
    {
      value: "chains",
      label: "Chains",
    },
    {
      value: "chains--handle",
      label: "Chains / Handle",
    },
    {
      value: "chains--impact",
      label: "Chains / Impact",
    },
    {
      value: "chains--movement",
      label: "Chains / Movement",
    },
    {
      value: "chemicals",
      label: "Chemicals",
    },
    {
      value: "chemicals--acid",
      label: "Chemicals / Acid",
    },
    {
      value: "chemicals--reaction",
      label: "Chemicals / Reaction",
    },
    {
      value: "clocks",
      label: "Clocks",
    },
    {
      value: "clocks--chime",
      label: "Clocks / Chime",
    },
    {
      value: "clocks--mechanics",
      label: "Clocks / Mechanics",
    },
    {
      value: "clocks--misc",
      label: "Clocks / Misc",
    },
    {
      value: "clocks--tick",
      label: "Clocks / Tick",
    },
    {
      value: "cloth",
      label: "Cloth",
    },
    {
      value: "cloth--flap",
      label: "Cloth / Flap",
    },
    {
      value: "cloth--handle",
      label: "Cloth / Handle",
    },
    {
      value: "cloth--impact",
      label: "Cloth / Impact",
    },
    {
      value: "cloth--movement",
      label: "Cloth / Movement",
    },
    {
      value: "cloth--rip",
      label: "Cloth / Rip",
    },
    {
      value: "communications",
      label: "Communications",
    },
    {
      value: "communications--audio-visual",
      label: "Communications / Audio Visual",
    },
    {
      value: "communications--camera",
      label: "Communications / Camera",
    },
    {
      value: "communications--cellphone",
      label: "Communications / Cellphone",
    },
    {
      value: "communications--microphone",
      label: "Communications / Microphone",
    },
    {
      value: "communications--misc",
      label: "Communications / Misc",
    },
    {
      value: "communications--phonograph",
      label: "Communications / Phonograph",
    },
    {
      value: "communications--radio",
      label: "Communications / Radio",
    },
    {
      value: "communications--static",
      label: "Communications / Static",
    },
    {
      value: "communications--telemetry",
      label: "Communications / Telemetry",
    },
    {
      value: "communications--telephone",
      label: "Communications / Telephone",
    },
    {
      value: "communications--television",
      label: "Communications / Television",
    },
    {
      value: "communications--transceiver",
      label: "Communications / Transceiver",
    },
    {
      value: "communications--typewriter",
      label: "Communications / Typewriter",
    },
    {
      value: "computers--hard-drive",
      label: "Computers / Hard Drive",
    },
    {
      value: "computers--keyboard-mouse",
      label: "Computers / Keyboard & Mouse",
    },
    {
      value: "computers--misc",
      label: "Computers / Misc",
    },
    {
      value: "creatures",
      label: "Creatures",
    },
    {
      value: "creatures--aquatic",
      label: "Creatures / Aquatic",
    },
    {
      value: "creatures--avian",
      label: "Creatures / Avian",
    },
    {
      value: "creatures--beast",
      label: "Creatures / Beast",
    },
    {
      value: "creatures--blob",
      label: "Creatures / Blob",
    },
    {
      value: "creatures--dinosaur",
      label: "Creatures / Dinosaur",
    },
    {
      value: "creatures--dragon",
      label: "Creatures / Dragon",
    },
    {
      value: "creatures--elemental",
      label: "Creatures / Elemental",
    },
    {
      value: "creatures--ethereal",
      label: "Creatures / Ethereal",
    },
    {
      value: "creatures--humanoid",
      label: "Creatures / Humanoid",
    },
    {
      value: "creatures--insectoid",
      label: "Creatures / Insectoid",
    },
    {
      value: "creatures--misc",
      label: "Creatures / Misc",
    },
    {
      value: "creatures--monster",
      label: "Creatures / Monster",
    },
    {
      value: "creatures--reptilian",
      label: "Creatures / Reptilian",
    },
    {
      value: "creatures--small",
      label: "Creatures / Small",
    },
    {
      value: "crowds",
      label: "Crowds",
    },
    {
      value: "crowds--angry",
      label: "Crowds / Angry",
    },
    {
      value: "crowds--applause",
      label: "Crowds / Applause",
    },
    {
      value: "crowds--battle",
      label: "Crowds / Battle",
    },
    {
      value: "crowds--celebration",
      label: "Crowds / Celebration",
    },
    {
      value: "crowds--cheering",
      label: "Crowds / Cheering",
    },
    {
      value: "crowds--children",
      label: "Crowds / Children",
    },
    {
      value: "crowds--conversation",
      label: "Crowds / Conversation",
    },
    {
      value: "crowds--laughter",
      label: "Crowds / Laughter",
    },
    {
      value: "crowds--loop-group",
      label: "Crowds / Loop Group",
    },
    {
      value: "crowds--misc",
      label: "Crowds / Misc",
    },
    {
      value: "crowds--panic",
      label: "Crowds / Panic",
    },
    {
      value: "crowds--quiet",
      label: "Crowds / Quiet",
    },
    {
      value: "crowds--reaction",
      label: "Crowds / Reaction",
    },
    {
      value: "crowds--singing",
      label: "Crowds / Singing",
    },
    {
      value: "crowds--sport",
      label: "Crowds / Sport",
    },
    {
      value: "crowds--walla",
      label: "Crowds / Walla",
    },
    {
      value: "designed--bass-dive",
      label: "Designed / Bass Dive",
    },
    {
      value: "designed--boom",
      label: "Designed / Boom",
    },
    {
      value: "designed--braam",
      label: "Designed / Braam",
    },
    {
      value: "designed--distortion",
      label: "Designed / Distortion",
    },
    {
      value: "designed--drone",
      label: "Designed / Drone",
    },
    {
      value: "designed--eerie",
      label: "Designed / Eerie",
    },
    {
      value: "designed--ethereal",
      label: "Designed / Ethereal",
    },
    {
      value: "designed--granular",
      label: "Designed / Granular",
    },
    {
      value: "designed--impact",
      label: "Designed / Impact",
    },
    {
      value: "designed--misc",
      label: "Designed / Misc",
    },
    {
      value: "designed--morph",
      label: "Designed / Morph",
    },
    {
      value: "designed--rhythmic",
      label: "Designed / Rhythmic",
    },
    {
      value: "designed--rumble",
      label: "Designed / Rumble",
    },
    {
      value: "designed--source",
      label: "Designed / Source",
    },
    {
      value: "designed--stinger",
      label: "Designed / Stinger",
    },
    {
      value: "designed--synthetic",
      label: "Designed / Synthetic",
    },
    {
      value: "designed--tonal",
      label: "Designed / Tonal",
    },
    {
      value: "designed--vocal",
      label: "Designed / Vocal",
    },
    {
      value: "designed--whoosh",
      label: "Designed / Whoosh",
    },
    {
      value: "destruction",
      label: "Destruction",
    },
    {
      value: "destruction--collapse",
      label: "Destruction / Collapse",
    },
    {
      value: "destruction--crash-debris",
      label: "Destruction / Crash & Debris",
    },
    {
      value: "destruction--misc",
      label: "Destruction / Misc",
    },
    {
      value: "dirt-sand",
      label: "Dirt & Sand",
    },
    {
      value: "dirt-sand--crash-debris",
      label: "Dirt & Sand / Crash & Debris",
    },
    {
      value: "dirt-sand--dust",
      label: "Dirt & Sand / Dust",
    },
    {
      value: "dirt-sand--handle",
      label: "Dirt & Sand / Handle",
    },
    {
      value: "dirt-sand--impact",
      label: "Dirt & Sand / Impact",
    },
    {
      value: "dirt-sand--movement",
      label: "Dirt & Sand / Movement",
    },
    {
      value: "doors",
      label: "Doors",
    },
    {
      value: "doors--antique",
      label: "Doors / Antique",
    },
    {
      value: "doors--appliance",
      label: "Doors / Appliance",
    },
    {
      value: "doors--cabinet",
      label: "Doors / Cabinet",
    },
    {
      value: "doors--composite",
      label: "Doors / Composite",
    },
    {
      value: "doors--creak",
      label: "Doors / Creak",
    },
    {
      value: "doors--dungeon",
      label: "Doors / Dungeon",
    },
    {
      value: "doors--electric",
      label: "Doors / Electric",
    },
    {
      value: "doors--gate",
      label: "Doors / Gate",
    },
    {
      value: "doors--glass",
      label: "Doors / Glass",
    },
    {
      value: "doors--hardware",
      label: "Doors / Hardware",
    },
    {
      value: "doors--hydraulic-pneumatic",
      label: "Doors / Hydraulic & Pneumatic",
    },
    {
      value: "doors--knock",
      label: "Doors / Knock",
    },
    {
      value: "doors--metal",
      label: "Doors / Metal",
    },
    {
      value: "doors--misc",
      label: "Doors / Misc",
    },
    {
      value: "doors--plastic",
      label: "Doors / Plastic",
    },
    {
      value: "doors--prison",
      label: "Doors / Prison",
    },
    {
      value: "doors--revolving",
      label: "Doors / Revolving",
    },
    {
      value: "doors--sliding",
      label: "Doors / Sliding",
    },
    {
      value: "doors--stone",
      label: "Doors / Stone",
    },
    {
      value: "doors--swinging",
      label: "Doors / Swinging",
    },
    {
      value: "doors--wood",
      label: "Doors / Wood",
    },
    {
      value: "drawers",
      label: "Drawers",
    },
    {
      value: "drawers--metal",
      label: "Drawers / Metal",
    },
    {
      value: "drawers--misc",
      label: "Drawers / Misc",
    },
    {
      value: "drawers--plastic",
      label: "Drawers / Plastic",
    },
    {
      value: "drawers--wood",
      label: "Drawers / Wood",
    },
    {
      value: "electricity",
      label: "Electricity",
    },
    {
      value: "electricity--arc",
      label: "Electricity / Arc",
    },
    {
      value: "electricity--buzz-hum",
      label: "Electricity / Buzz & Hum",
    },
    {
      value: "electricity--electromagnetic",
      label: "Electricity / Electromagnetic",
    },
    {
      value: "electricity--misc",
      label: "Electricity / Misc",
    },
    {
      value: "electricity--sparks",
      label: "Electricity / Sparks",
    },
    {
      value: "electricity--zap",
      label: "Electricity / Zap",
    },
    {
      value: "equipment",
      label: "Equipment",
    },
    {
      value: "equipment--bridle-tack",
      label: "Equipment / Bridle & Tack",
    },
    {
      value: "equipment--misc",
      label: "Equipment / Misc",
    },
    {
      value: "equipment--recreational",
      label: "Equipment / Recreational",
    },
    {
      value: "equipment--sport",
      label: "Equipment / Sport",
    },
    {
      value: "equipment--tactical",
      label: "Equipment / Tactical",
    },
    {
      value: "explosions",
      label: "Explosions",
    },
    {
      value: "explosions--designed",
      label: "Explosions / Designed",
    },
    {
      value: "explosions--misc",
      label: "Explosions / Misc",
    },
    {
      value: "explosions--real",
      label: "Explosions / Real",
    },
    {
      value: "farts",
      label: "Farts",
    },
    {
      value: "farts--designed",
      label: "Farts / Designed",
    },
    {
      value: "farts--real",
      label: "Farts / Real",
    },
    {
      value: "fight",
      label: "Fight",
    },
    {
      value: "fight--bodyfall",
      label: "Fight / Bodyfall",
    },
    {
      value: "fight--cloth",
      label: "Fight / Cloth",
    },
    {
      value: "fight--grab",
      label: "Fight / Grab",
    },
    {
      value: "fight--impact",
      label: "Fight / Impact",
    },
    {
      value: "fight--misc",
      label: "Fight / Misc",
    },
    {
      value: "fire",
      label: "Fire",
    },
    {
      value: "fire--burning",
      label: "Fire / Burning",
    },
    {
      value: "fire--burst",
      label: "Fire / Burst",
    },
    {
      value: "fire--crackle",
      label: "Fire / Crackle",
    },
    {
      value: "fire--gas",
      label: "Fire / Gas",
    },
    {
      value: "fire--ignite",
      label: "Fire / Ignite",
    },
    {
      value: "fire--misc",
      label: "Fire / Misc",
    },
    {
      value: "fire--sizzle",
      label: "Fire / Sizzle",
    },
    {
      value: "fire--torch",
      label: "Fire / Torch",
    },
    {
      value: "fire--turbulent",
      label: "Fire / Turbulent",
    },
    {
      value: "fire--whoosh",
      label: "Fire / Whoosh",
    },
    {
      value: "fireworks",
      label: "Fireworks",
    },
    {
      value: "fireworks--commercial",
      label: "Fireworks / Commercial",
    },
    {
      value: "fireworks--misc",
      label: "Fireworks / Misc",
    },
    {
      value: "fireworks--recreational",
      label: "Fireworks / Recreational",
    },
    {
      value: "food-drink",
      label: "Food & Drink",
    },
    {
      value: "food-drink--cooking",
      label: "Food & Drink / Cooking",
    },
    {
      value: "food-drink--drinking",
      label: "Food & Drink / Drinking",
    },
    {
      value: "food-drink--eating",
      label: "Food & Drink / Eating",
    },
    {
      value: "food-drink--glassware",
      label: "Food & Drink / Glassware",
    },
    {
      value: "food-drink--ingredients",
      label: "Food & Drink / Ingredients",
    },
    {
      value: "food-drink--kitchenware",
      label: "Food & Drink / Kitchenware",
    },
    {
      value: "food-drink--misc",
      label: "Food & Drink / Misc",
    },
    {
      value: "food-drink--pour",
      label: "Food & Drink / Pour",
    },
    {
      value: "food-drink--tableware",
      label: "Food & Drink / Tableware",
    },
    {
      value: "footsteps",
      label: "Footsteps",
    },
    {
      value: "footsteps--animal",
      label: "Footsteps / Animal",
    },
    {
      value: "footsteps--creature",
      label: "Footsteps / Creature",
    },
    {
      value: "footsteps--horse",
      label: "Footsteps / Horse",
    },
    {
      value: "footsteps--human",
      label: "Footsteps / Human",
    },
    {
      value: "games",
      label: "Games",
    },
    {
      value: "games--arcade",
      label: "Games / Arcade",
    },
    {
      value: "games--board",
      label: "Games / Board",
    },
    {
      value: "games--casino",
      label: "Games / Casino",
    },
    {
      value: "games--misc",
      label: "Games / Misc",
    },
    {
      value: "games--video",
      label: "Games / Video",
    },
    {
      value: "geothermal",
      label: "Geothermal",
    },
    {
      value: "geothermal--geyser",
      label: "Geothermal / Geyser",
    },
    {
      value: "geothermal--lava",
      label: "Geothermal / Lava",
    },
    {
      value: "glass",
      label: "Glass",
    },
    {
      value: "glass--break",
      label: "Glass / Break",
    },
    {
      value: "glass--crash-debris",
      label: "Glass / Crash & Debris",
    },
    {
      value: "glass--friction",
      label: "Glass / Friction",
    },
    {
      value: "glass--handle",
      label: "Glass / Handle",
    },
    {
      value: "glass--impact",
      label: "Glass / Impact",
    },
    {
      value: "glass--misc",
      label: "Glass / Misc",
    },
    {
      value: "glass--movement",
      label: "Glass / Movement",
    },
    {
      value: "glass--tonal",
      label: "Glass / Tonal",
    },
    {
      value: "gore",
      label: "Gore",
    },
    {
      value: "gore--blood",
      label: "Gore / Blood",
    },
    {
      value: "gore--bone",
      label: "Gore / Bone",
    },
    {
      value: "gore--burn",
      label: "Gore / Burn",
    },
    {
      value: "gore--flesh",
      label: "Gore / Flesh",
    },
    {
      value: "gore--misc",
      label: "Gore / Misc",
    },
    {
      value: "gore--ooze",
      label: "Gore / Ooze",
    },
    {
      value: "gore--source",
      label: "Gore / Source",
    },
    {
      value: "gore--splat",
      label: "Gore / Splat",
    },
    {
      value: "gore--squish",
      label: "Gore / Squish",
    },
    {
      value: "gore--stab",
      label: "Gore / Stab",
    },
    {
      value: "guns",
      label: "Guns",
    },
    {
      value: "guns--antique",
      label: "Guns / Antique",
    },
    {
      value: "guns--artillery",
      label: "Guns / Artillery",
    },
    {
      value: "guns--automatic",
      label: "Guns / Automatic",
    },
    {
      value: "guns--cannon",
      label: "Guns / Cannon",
    },
    {
      value: "guns--handle",
      label: "Guns / Handle",
    },
    {
      value: "guns--hitech",
      label: "Guns / Hitech",
    },
    {
      value: "guns--mechanism",
      label: "Guns / Mechanism",
    },
    {
      value: "guns--misc",
      label: "Guns / Misc",
    },
    {
      value: "guns--pistol",
      label: "Guns / Pistol",
    },
    {
      value: "guns--rifle",
      label: "Guns / Rifle",
    },
    {
      value: "guns--shotgun",
      label: "Guns / Shotgun",
    },
    {
      value: "guns--suppressed",
      label: "Guns / Suppressed",
    },
    {
      value: "horns",
      label: "Horns",
    },
    {
      value: "horns--air-powered",
      label: "Horns / Air Powered",
    },
    {
      value: "horns--celebration",
      label: "Horns / Celebration",
    },
    {
      value: "horns--misc",
      label: "Horns / Misc",
    },
    {
      value: "horns--traditional",
      label: "Horns / Traditional",
    },
    {
      value: "human",
      label: "Human",
    },
    {
      value: "human--blow",
      label: "Human / Blow",
    },
    {
      value: "human--breath",
      label: "Human / Breath",
    },
    {
      value: "human--burp",
      label: "Human / Burp",
    },
    {
      value: "human--cough",
      label: "Human / Cough",
    },
    {
      value: "human--heartbeat",
      label: "Human / Heartbeat",
    },
    {
      value: "human--kiss",
      label: "Human / Kiss",
    },
    {
      value: "human--misc",
      label: "Human / Misc",
    },
    {
      value: "human--pee",
      label: "Human / Pee",
    },
    {
      value: "human--skin",
      label: "Human / Skin",
    },
    {
      value: "human--sneeze",
      label: "Human / Sneeze",
    },
    {
      value: "human--sniff",
      label: "Human / Sniff",
    },
    {
      value: "human--snore",
      label: "Human / Snore",
    },
    {
      value: "human--spit",
      label: "Human / Spit",
    },
    {
      value: "human--vomit",
      label: "Human / Vomit",
    },
    {
      value: "ice",
      label: "Ice",
    },
    {
      value: "ice--break",
      label: "Ice / Break",
    },
    {
      value: "ice--crash-debris",
      label: "Ice / Crash & Debris",
    },
    {
      value: "ice--friction",
      label: "Ice / Friction",
    },
    {
      value: "ice--handle",
      label: "Ice / Handle",
    },
    {
      value: "ice--impact",
      label: "Ice / Impact",
    },
    {
      value: "ice--misc",
      label: "Ice / Misc",
    },
    {
      value: "ice--movement",
      label: "Ice / Movement",
    },
    {
      value: "ice--tonal",
      label: "Ice / Tonal",
    },
    {
      value: "lasers",
      label: "Lasers",
    },
    {
      value: "lasers--beam",
      label: "Lasers / Beam",
    },
    {
      value: "lasers--gun",
      label: "Lasers / Gun",
    },
    {
      value: "lasers--misc",
      label: "Lasers / Misc",
    },
    {
      value: "leather",
      label: "Leather",
    },
    {
      value: "leather--creak",
      label: "Leather / Creak",
    },
    {
      value: "leather--handle",
      label: "Leather / Handle",
    },
    {
      value: "leather--impact",
      label: "Leather / Impact",
    },
    {
      value: "leather--movement",
      label: "Leather / Movement",
    },
    {
      value: "liquid-mud",
      label: "Liquid & Mud",
    },
    {
      value: "liquid-mud--bubbles",
      label: "Liquid & Mud / Bubbles",
    },
    {
      value: "liquid-mud--impact",
      label: "Liquid & Mud / Impact",
    },
    {
      value: "liquid-mud--misc",
      label: "Liquid & Mud / Misc",
    },
    {
      value: "liquid-mud--movement",
      label: "Liquid & Mud / Movement",
    },
    {
      value: "liquid-mud--suction",
      label: "Liquid & Mud / Suction",
    },
    {
      value: "machines",
      label: "Machines",
    },
    {
      value: "machines--amusement",
      label: "Machines / Amusement",
    },
    {
      value: "machines--antique",
      label: "Machines / Antique",
    },
    {
      value: "machines--appliance",
      label: "Machines / Appliance",
    },
    {
      value: "machines--construction",
      label: "Machines / Construction",
    },
    {
      value: "machines--elevator",
      label: "Machines / Elevator",
    },
    {
      value: "machines--escalator",
      label: "Machines / Escalator",
    },
    {
      value: "machines--fan",
      label: "Machines / Fan",
    },
    {
      value: "machines--garden",
      label: "Machines / Garden",
    },
    {
      value: "machines--gym",
      label: "Machines / Gym",
    },
    {
      value: "machines--hitech",
      label: "Machines / Hitech",
    },
    {
      value: "machines--hvac",
      label: "Machines / Hvac",
    },
    {
      value: "machines--industrial",
      label: "Machines / Industrial",
    },
    {
      value: "machines--mechanism",
      label: "Machines / Mechanism",
    },
    {
      value: "machines--medical",
      label: "Machines / Medical",
    },
    {
      value: "machines--misc",
      label: "Machines / Misc",
    },
    {
      value: "machines--office",
      label: "Machines / Office",
    },
    {
      value: "machines--pump",
      label: "Machines / Pump",
    },
    {
      value: "magic",
      label: "Magic",
    },
    {
      value: "magic--angelic",
      label: "Magic / Angelic",
    },
    {
      value: "magic--elemental",
      label: "Magic / Elemental",
    },
    {
      value: "magic--evil",
      label: "Magic / Evil",
    },
    {
      value: "magic--misc",
      label: "Magic / Misc",
    },
    {
      value: "magic--poof",
      label: "Magic / Poof",
    },
    {
      value: "magic--shimmer",
      label: "Magic / Shimmer",
    },
    {
      value: "magic--spell",
      label: "Magic / Spell",
    },
    {
      value: "mechanical",
      label: "Mechanical",
    },
    {
      value: "mechanical--click",
      label: "Mechanical / Click",
    },
    {
      value: "mechanical--gears",
      label: "Mechanical / Gears",
    },
    {
      value: "mechanical--hydraulic-pneumatic",
      label: "Mechanical / Hydraulic & Pneumatic",
    },
    {
      value: "mechanical--latch",
      label: "Mechanical / Latch",
    },
    {
      value: "mechanical--lever",
      label: "Mechanical / Lever",
    },
    {
      value: "mechanical--lock",
      label: "Mechanical / Lock",
    },
    {
      value: "mechanical--misc",
      label: "Mechanical / Misc",
    },
    {
      value: "mechanical--pulley",
      label: "Mechanical / Pulley",
    },
    {
      value: "mechanical--ratchet",
      label: "Mechanical / Ratchet",
    },
    {
      value: "mechanical--relay",
      label: "Mechanical / Relay",
    },
    {
      value: "mechanical--roller",
      label: "Mechanical / Roller",
    },
    {
      value: "mechanical--switch",
      label: "Mechanical / Switch",
    },
    {
      value: "metal",
      label: "Metal",
    },
    {
      value: "metal--break",
      label: "Metal / Break",
    },
    {
      value: "metal--crash-debris",
      label: "Metal / Crash & Debris",
    },
    {
      value: "metal--friction",
      label: "Metal / Friction",
    },
    {
      value: "metal--handle",
      label: "Metal / Handle",
    },
    {
      value: "metal--impact",
      label: "Metal / Impact",
    },
    {
      value: "metal--misc",
      label: "Metal / Misc",
    },
    {
      value: "metal--movement",
      label: "Metal / Movement",
    },
    {
      value: "metal--tonal",
      label: "Metal / Tonal",
    },
    {
      value: "motors",
      label: "Motors",
    },
    {
      value: "motors--antique",
      label: "Motors / Antique",
    },
    {
      value: "motors--combustion",
      label: "Motors / Combustion",
    },
    {
      value: "motors--electric",
      label: "Motors / Electric",
    },
    {
      value: "motors--misc",
      label: "Motors / Misc",
    },
    {
      value: "motors--servo",
      label: "Motors / Servo",
    },
    {
      value: "motors--turbine",
      label: "Motors / Turbine",
    },
    {
      value: "movement",
      label: "Movement",
    },
    {
      value: "movement--activity",
      label: "Movement / Activity",
    },
    {
      value: "movement--crowd",
      label: "Movement / Crowd",
    },
    {
      value: "movement--human",
      label: "Movement / Human",
    },
    {
      value: "movement--insect",
      label: "Movement / Insect",
    },
    {
      value: "movement--misc",
      label: "Movement / Misc",
    },
    {
      value: "movement--presence",
      label: "Movement / Presence",
    },
    {
      value: "musical",
      label: "Musical",
    },
    {
      value: "musical--bells",
      label: "Musical / Bells",
    },
    {
      value: "musical--chime",
      label: "Musical / Chime",
    },
    {
      value: "musical--choral",
      label: "Musical / Choral",
    },
    {
      value: "musical--experimental",
      label: "Musical / Experimental",
    },
    {
      value: "musical--instrument",
      label: "Musical / Instrument",
    },
    {
      value: "musical--keyed",
      label: "Musical / Keyed",
    },
    {
      value: "musical--loop",
      label: "Musical / Loop",
    },
    {
      value: "musical--misc",
      label: "Musical / Misc",
    },
    {
      value: "musical--percussion",
      label: "Musical / Percussion",
    },
    {
      value: "musical--percussion-tuned",
      label: "Musical / Percussion Tuned",
    },
    {
      value: "musical--performance",
      label: "Musical / Performance",
    },
    {
      value: "musical--plucked",
      label: "Musical / Plucked",
    },
    {
      value: "musical--sample",
      label: "Musical / Sample",
    },
    {
      value: "musical--shaken",
      label: "Musical / Shaken",
    },
    {
      value: "musical--song-phrase",
      label: "Musical / Song & Phrase",
    },
    {
      value: "musical--stinger",
      label: "Musical / Stinger",
    },
    {
      value: "musical--stringed",
      label: "Musical / Stringed",
    },
    {
      value: "musical--synthesized",
      label: "Musical / Synthesized",
    },
    {
      value: "musical--toy",
      label: "Musical / Toy",
    },
    {
      value: "musical--woodwind",
      label: "Musical / Woodwind",
    },
    {
      value: "natural-disaster",
      label: "Natural Disaster",
    },
    {
      value: "natural-disaster--avalanche",
      label: "Natural Disaster / Avalanche",
    },
    {
      value: "natural-disaster--earthquake",
      label: "Natural Disaster / Earthquake",
    },
    {
      value: "objects--bag",
      label: "Objects / Bag",
    },
    {
      value: "objects--book",
      label: "Objects / Book",
    },
    {
      value: "objects--coin",
      label: "Objects / Coin",
    },
    {
      value: "objects--container",
      label: "Objects / Container",
    },
    {
      value: "objects--fashion",
      label: "Objects / Fashion",
    },
    {
      value: "objects--furniture",
      label: "Objects / Furniture",
    },
    {
      value: "objects--garden",
      label: "Objects / Garden",
    },
    {
      value: "objects--gym",
      label: "Objects / Gym",
    },
    {
      value: "objects--household",
      label: "Objects / Household",
    },
    {
      value: "objects--jewelry",
      label: "Objects / Jewelry",
    },
    {
      value: "objects--keys",
      label: "Objects / Keys",
    },
    {
      value: "objects--luggage",
      label: "Objects / Luggage",
    },
    {
      value: "objects--medical",
      label: "Objects / Medical",
    },
    {
      value: "objects--misc",
      label: "Objects / Misc",
    },
    {
      value: "objects--office",
      label: "Objects / Office",
    },
    {
      value: "objects--packaging",
      label: "Objects / Packaging",
    },
    {
      value: "objects--tape",
      label: "Objects / Tape",
    },
    {
      value: "objects--umbrella",
      label: "Objects / Umbrella",
    },
    {
      value: "objects--wheeled",
      label: "Objects / Wheeled",
    },
    {
      value: "objects--writing",
      label: "Objects / Writing",
    },
    {
      value: "objects--zipper",
      label: "Objects / Zipper",
    },
    {
      value: "paper",
      label: "Paper",
    },
    {
      value: "paper--flutter",
      label: "Paper / Flutter",
    },
    {
      value: "paper--friction",
      label: "Paper / Friction",
    },
    {
      value: "paper--handle",
      label: "Paper / Handle",
    },
    {
      value: "paper--impact",
      label: "Paper / Impact",
    },
    {
      value: "paper--misc",
      label: "Paper / Misc",
    },
    {
      value: "paper--rip",
      label: "Paper / Rip",
    },
    {
      value: "plastic",
      label: "Plastic",
    },
    {
      value: "plastic--break",
      label: "Plastic / Break",
    },
    {
      value: "plastic--crash-debris",
      label: "Plastic / Crash & Debris",
    },
    {
      value: "plastic--friction",
      label: "Plastic / Friction",
    },
    {
      value: "plastic--handle",
      label: "Plastic / Handle",
    },
    {
      value: "plastic--impact",
      label: "Plastic / Impact",
    },
    {
      value: "plastic--misc",
      label: "Plastic / Misc",
    },
    {
      value: "plastic--movement",
      label: "Plastic / Movement",
    },
    {
      value: "plastic--tonal",
      label: "Plastic / Tonal",
    },
    {
      value: "rain--cloth",
      label: "Rain / Cloth",
    },
    {
      value: "rain--concrete",
      label: "Rain / Concrete",
    },
    {
      value: "rain--general",
      label: "Rain / General",
    },
    {
      value: "rain--glass",
      label: "Rain / Glass",
    },
    {
      value: "rain--interior",
      label: "Rain / Interior",
    },
    {
      value: "rain--metal",
      label: "Rain / Metal",
    },
    {
      value: "rain--plastic",
      label: "Rain / Plastic",
    },
    {
      value: "rain--vegetation",
      label: "Rain / Vegetation",
    },
    {
      value: "rain--water",
      label: "Rain / Water",
    },
    {
      value: "rain--wood",
      label: "Rain / Wood",
    },
    {
      value: "robots",
      label: "Robots",
    },
    {
      value: "robots--misc",
      label: "Robots / Misc",
    },
    {
      value: "robots--movement",
      label: "Robots / Movement",
    },
    {
      value: "robots--vocal",
      label: "Robots / Vocal",
    },
    {
      value: "rocks",
      label: "Rocks",
    },
    {
      value: "rocks--break",
      label: "Rocks / Break",
    },
    {
      value: "rocks--crash-debris",
      label: "Rocks / Crash & Debris",
    },
    {
      value: "rocks--friction",
      label: "Rocks / Friction",
    },
    {
      value: "rocks--handle",
      label: "Rocks / Handle",
    },
    {
      value: "rocks--impact",
      label: "Rocks / Impact",
    },
    {
      value: "rocks--movement",
      label: "Rocks / Movement",
    },
    {
      value: "rope",
      label: "Rope",
    },
    {
      value: "rope--creak",
      label: "Rope / Creak",
    },
    {
      value: "rope--handle",
      label: "Rope / Handle",
    },
    {
      value: "rope--impact",
      label: "Rope / Impact",
    },
    {
      value: "rope--movement",
      label: "Rope / Movement",
    },
    {
      value: "rubber",
      label: "Rubber",
    },
    {
      value: "rubber--friction",
      label: "Rubber / Friction",
    },
    {
      value: "rubber--handle",
      label: "Rubber / Handle",
    },
    {
      value: "rubber--impact",
      label: "Rubber / Impact",
    },
    {
      value: "rubber--misc",
      label: "Rubber / Misc",
    },
    {
      value: "rubber--movement",
      label: "Rubber / Movement",
    },
    {
      value: "rubber--tonal",
      label: "Rubber / Tonal",
    },
    {
      value: "scifi",
      label: "Scifi",
    },
    {
      value: "scifi--alarm",
      label: "Scifi / Alarm",
    },
    {
      value: "scifi--computer",
      label: "Scifi / Computer",
    },
    {
      value: "scifi--door",
      label: "Scifi / Door",
    },
    {
      value: "scifi--energy",
      label: "Scifi / Energy",
    },
    {
      value: "scifi--impact",
      label: "Scifi / Impact",
    },
    {
      value: "scifi--machine",
      label: "Scifi / Machine",
    },
    {
      value: "scifi--mechanism",
      label: "Scifi / Mechanism",
    },
    {
      value: "scifi--misc",
      label: "Scifi / Misc",
    },
    {
      value: "scifi--retro",
      label: "Scifi / Retro",
    },
    {
      value: "scifi--spaceship",
      label: "Scifi / Spaceship",
    },
    {
      value: "scifi--vehicle",
      label: "Scifi / Vehicle",
    },
    {
      value: "scifi--weapon",
      label: "Scifi / Weapon",
    },
    {
      value: "snow",
      label: "Snow",
    },
    {
      value: "snow--crash-debris",
      label: "Snow / Crash & Debris",
    },
    {
      value: "snow--friction",
      label: "Snow / Friction",
    },
    {
      value: "snow--handle",
      label: "Snow / Handle",
    },
    {
      value: "snow--impact",
      label: "Snow / Impact",
    },
    {
      value: "snow--misc",
      label: "Snow / Misc",
    },
    {
      value: "snow--movement",
      label: "Snow / Movement",
    },
    {
      value: "sports",
      label: "Sports",
    },
    {
      value: "sports--court",
      label: "Sports / Court",
    },
    {
      value: "sports--field",
      label: "Sports / Field",
    },
    {
      value: "sports--gym",
      label: "Sports / Gym",
    },
    {
      value: "sports--indoor",
      label: "Sports / Indoor",
    },
    {
      value: "sports--misc",
      label: "Sports / Misc",
    },
    {
      value: "sports--skate",
      label: "Sports / Skate",
    },
    {
      value: "sports--track-field",
      label: "Sports / Track & Field",
    },
    {
      value: "sports--water",
      label: "Sports / Water",
    },
    {
      value: "sports--winter",
      label: "Sports / Winter",
    },
    {
      value: "swooshes--swish",
      label: "Swooshes / Swish",
    },
    {
      value: "test-files",
      label: "Test Files",
    },
    {
      value: "tools",
      label: "Tools",
    },
    {
      value: "tools--garden",
      label: "Tools / Garden",
    },
    {
      value: "tools--hand",
      label: "Tools / Hand",
    },
    {
      value: "tools--misc",
      label: "Tools / Misc",
    },
    {
      value: "tools--pneumatic",
      label: "Tools / Pneumatic",
    },
    {
      value: "tools--power",
      label: "Tools / Power",
    },
    {
      value: "toys",
      label: "Toys",
    },
    {
      value: "toys--electronic",
      label: "Toys / Electronic",
    },
    {
      value: "toys--mechanical",
      label: "Toys / Mechanical",
    },
    {
      value: "toys--misc",
      label: "Toys / Misc",
    },
    {
      value: "trains",
      label: "Trains",
    },
    {
      value: "trains--clack",
      label: "Trains / Clack",
    },
    {
      value: "trains--diesel",
      label: "Trains / Diesel",
    },
    {
      value: "trains--door",
      label: "Trains / Door",
    },
    {
      value: "trains--electric",
      label: "Trains / Electric",
    },
    {
      value: "trains--high-speed",
      label: "Trains / High Speed",
    },
    {
      value: "trains--horn",
      label: "Trains / Horn",
    },
    {
      value: "trains--interior",
      label: "Trains / Interior",
    },
    {
      value: "trains--mechanism",
      label: "Trains / Mechanism",
    },
    {
      value: "trains--misc",
      label: "Trains / Misc",
    },
    {
      value: "trains--steam",
      label: "Trains / Steam",
    },
    {
      value: "trains--subway",
      label: "Trains / Subway",
    },
    {
      value: "trains--tram",
      label: "Trains / Tram",
    },
    {
      value: "user-interface--alert",
      label: "User Interface / Alert",
    },
    {
      value: "user-interface--beep",
      label: "User Interface / Beep",
    },
    {
      value: "user-interface--click",
      label: "User Interface / Click",
    },
    {
      value: "user-interface--data",
      label: "User Interface / Data",
    },
    {
      value: "user-interface--glitch",
      label: "User Interface / Glitch",
    },
    {
      value: "user-interface--misc",
      label: "User Interface / Misc",
    },
    {
      value: "user-interface--motion",
      label: "User Interface / Motion",
    },
    {
      value: "vegetation",
      label: "Vegetation",
    },
    {
      value: "vegetation--grass",
      label: "Vegetation / Grass",
    },
    {
      value: "vegetation--leaves",
      label: "Vegetation / Leaves",
    },
    {
      value: "vegetation--misc",
      label: "Vegetation / Misc",
    },
    {
      value: "vegetation--tree",
      label: "Vegetation / Tree",
    },
    {
      value: "vehcar-bmw-z3-e36-7-1995",
      label: "Vehcar Bmw Z3 E36 7 1995",
    },
    {
      value: "vehicles--alarm",
      label: "Vehicles / Alarm",
    },
    {
      value: "vehicles--antique",
      label: "Vehicles / Antique",
    },
    {
      value: "vehicles--atv",
      label: "Vehicles / Atv",
    },
    {
      value: "vehicles--bicycle",
      label: "Vehicles / Bicycle",
    },
    {
      value: "vehicles--brake",
      label: "Vehicles / Brake",
    },
    {
      value: "vehicles--bus",
      label: "Vehicles / Bus",
    },
    {
      value: "vehicles--car",
      label: "Vehicles / Car",
    },
    {
      value: "vehicles--construction",
      label: "Vehicles / Construction",
    },
    {
      value: "vehicles--door",
      label: "Vehicles / Door",
    },
    {
      value: "vehicles--electric",
      label: "Vehicles / Electric",
    },
    {
      value: "vehicles--emergency",
      label: "Vehicles / Emergency",
    },
    {
      value: "vehicles--farm",
      label: "Vehicles / Farm",
    },
    {
      value: "vehicles--freight",
      label: "Vehicles / Freight",
    },
    {
      value: "vehicles--generic-by",
      label: "Vehicles / Generic By",
    },
    {
      value: "vehicles--horn",
      label: "Vehicles / Horn",
    },
    {
      value: "vehicles--interior",
      label: "Vehicles / Interior",
    },
    {
      value: "vehicles--jalopy",
      label: "Vehicles / Jalopy",
    },
    {
      value: "vehicles--mechanism",
      label: "Vehicles / Mechanism",
    },
    {
      value: "vehicles--military",
      label: "Vehicles / Military",
    },
    {
      value: "vehicles--misc",
      label: "Vehicles / Misc",
    },
    {
      value: "vehicles--motorcycle",
      label: "Vehicles / Motorcycle",
    },
    {
      value: "vehicles--racing",
      label: "Vehicles / Racing",
    },
    {
      value: "vehicles--siren",
      label: "Vehicles / Siren",
    },
    {
      value: "vehicles--skid",
      label: "Vehicles / Skid",
    },
    {
      value: "vehicles--suspension",
      label: "Vehicles / Suspension",
    },
    {
      value: "vehicles--tire",
      label: "Vehicles / Tire",
    },
    {
      value: "vehicles--truck-van-suv",
      label: "Vehicles / Truck Van & Suv",
    },
    {
      value: "vehicles--utility",
      label: "Vehicles / Utility",
    },
    {
      value: "vehicles--wagon",
      label: "Vehicles / Wagon",
    },
    {
      value: "vehicles--window",
      label: "Vehicles / Window",
    },
    {
      value: "voices--alien",
      label: "Voices / Alien",
    },
    {
      value: "voices--baby",
      label: "Voices / Baby",
    },
    {
      value: "voices--cheer",
      label: "Voices / Cheer",
    },
    {
      value: "voices--child",
      label: "Voices / Child",
    },
    {
      value: "voices--crying",
      label: "Voices / Crying",
    },
    {
      value: "voices--efforts",
      label: "Voices / Efforts",
    },
    {
      value: "voices--female",
      label: "Voices / Female",
    },
    {
      value: "voices--futzed",
      label: "Voices / Futzed",
    },
    {
      value: "voices--laugh",
      label: "Voices / Laugh",
    },
    {
      value: "voices--male",
      label: "Voices / Male",
    },
    {
      value: "voices--misc",
      label: "Voices / Misc",
    },
    {
      value: "voices--reaction",
      label: "Voices / Reaction",
    },
    {
      value: "voices--scream",
      label: "Voices / Scream",
    },
    {
      value: "voices--singing",
      label: "Voices / Singing",
    },
    {
      value: "voices--whisper",
      label: "Voices / Whisper",
    },
    {
      value: "water--bubbles",
      label: "Water / Bubbles",
    },
    {
      value: "water--drain",
      label: "Water / Drain",
    },
    {
      value: "water--drip",
      label: "Water / Drip",
    },
    {
      value: "water--fizz",
      label: "Water / Fizz",
    },
    {
      value: "water--flow",
      label: "Water / Flow",
    },
    {
      value: "water--fountain",
      label: "Water / Fountain",
    },
    {
      value: "water--impact",
      label: "Water / Impact",
    },
    {
      value: "water--lap",
      label: "Water / Lap",
    },
    {
      value: "water--misc",
      label: "Water / Misc",
    },
    {
      value: "water--movement",
      label: "Water / Movement",
    },
    {
      value: "water--plumbing",
      label: "Water / Plumbing",
    },
    {
      value: "water--pour",
      label: "Water / Pour",
    },
    {
      value: "water--splash",
      label: "Water / Splash",
    },
    {
      value: "water--spray",
      label: "Water / Spray",
    },
    {
      value: "water--steam",
      label: "Water / Steam",
    },
    {
      value: "water--surf",
      label: "Water / Surf",
    },
    {
      value: "water--turbulent",
      label: "Water / Turbulent",
    },
    {
      value: "water--underwater",
      label: "Water / Underwater",
    },
    {
      value: "water--waterfall",
      label: "Water / Waterfall",
    },
    {
      value: "water--wave",
      label: "Water / Wave",
    },
    {
      value: "weapons",
      label: "Weapons",
    },
    {
      value: "weapons--armor",
      label: "Weapons / Armor",
    },
    {
      value: "weapons--arrow",
      label: "Weapons / Arrow",
    },
    {
      value: "weapons--axe",
      label: "Weapons / Axe",
    },
    {
      value: "weapons--blunt",
      label: "Weapons / Blunt",
    },
    {
      value: "weapons--bow",
      label: "Weapons / Bow",
    },
    {
      value: "weapons--knife",
      label: "Weapons / Knife",
    },
    {
      value: "weapons--misc",
      label: "Weapons / Misc",
    },
    {
      value: "weapons--polearm",
      label: "Weapons / Polearm",
    },
    {
      value: "weapons--siege",
      label: "Weapons / Siege",
    },
    {
      value: "weapons--sword",
      label: "Weapons / Sword",
    },
    {
      value: "weapons--whip",
      label: "Weapons / Whip",
    },
    {
      value: "weather",
      label: "Weather",
    },
    {
      value: "weather--hail",
      label: "Weather / Hail",
    },
    {
      value: "weather--misc",
      label: "Weather / Misc",
    },
    {
      value: "weather--storm",
      label: "Weather / Storm",
    },
    {
      value: "weather--thunder",
      label: "Weather / Thunder",
    },
    {
      value: "whistles",
      label: "Whistles",
    },
    {
      value: "whistles--human",
      label: "Whistles / Human",
    },
    {
      value: "whistles--mechanical",
      label: "Whistles / Mechanical",
    },
    {
      value: "whistles--misc",
      label: "Whistles / Misc",
    },
    {
      value: "wind--designed",
      label: "Wind / Designed",
    },
    {
      value: "wind--general",
      label: "Wind / General",
    },
    {
      value: "wind--gust",
      label: "Wind / Gust",
    },
    {
      value: "wind--interior",
      label: "Wind / Interior",
    },
    {
      value: "wind--tonal",
      label: "Wind / Tonal",
    },
    {
      value: "wind--turbulent",
      label: "Wind / Turbulent",
    },
    {
      value: "wind--vegetation",
      label: "Wind / Vegetation",
    },
    {
      value: "windows",
      label: "Windows",
    },
    {
      value: "windows--covering",
      label: "Windows / Covering",
    },
    {
      value: "windows--hardware",
      label: "Windows / Hardware",
    },
    {
      value: "windows--knock",
      label: "Windows / Knock",
    },
    {
      value: "windows--metal",
      label: "Windows / Metal",
    },
    {
      value: "windows--misc",
      label: "Windows / Misc",
    },
    {
      value: "windows--plastic",
      label: "Windows / Plastic",
    },
    {
      value: "windows--wood",
      label: "Windows / Wood",
    },
    {
      value: "wings",
      label: "Wings",
    },
    {
      value: "wings--bird",
      label: "Wings / Bird",
    },
    {
      value: "wings--creature",
      label: "Wings / Creature",
    },
    {
      value: "wings--insect",
      label: "Wings / Insect",
    },
    {
      value: "wood",
      label: "Wood",
    },
    {
      value: "wood--break",
      label: "Wood / Break",
    },
    {
      value: "wood--crash-debris",
      label: "Wood / Crash & Debris",
    },
    {
      value: "wood--friction",
      label: "Wood / Friction",
    },
    {
      value: "wood--handle",
      label: "Wood / Handle",
    },
    {
      value: "wood--impact",
      label: "Wood / Impact",
    },
    {
      value: "wood--misc",
      label: "Wood / Misc",
    },
    {
      value: "wood--movement",
      label: "Wood / Movement",
    },
    {
      value: "wood--tonal",
      label: "Wood / Tonal",
    },
  ],
  themes: [
    {
      label: "Epidemic Essentials",
      value: "Epidemic Essentials",
    },
    {
      label: "Creator’s Picks",
      value: "Creator’s Picks",
    },
    {
      label: "re/works by Epidemic Sound",
      value: "re/works by Epidemic Sound",
    },
    {
      label: "Ads, Promos & Trailers",
      value: "Ads, Promos & Trailers",
    },
    {
      label: "Arts & Crafts",
      value: "Arts & Crafts",
    },
    {
      label: "Artist Spotlight",
      value: "Artist Spotlight",
    },
    {
      label: "Broadcasting",
      value: "Broadcasting",
    },
    {
      label: "Celebrating Community",
      value: "Celebrating Community",
    },
    {
      label: "Cinematic",
      value: "Cinematic",
    },
    {
      label: "Classical Collection",
      value: "Classical Collection",
    },
    {
      label: "Club Scene",
      value: "Club Scene",
    },
    {
      label: "Cooking",
      value: "Cooking",
    },
    {
      label: "Comedy",
      value: "Comedy",
    },
    {
      label: "Corporate",
      value: "Corporate",
    },
    {
      label: "Cultural Festivities",
      value: "Cultural Festivities",
    },
    {
      label: "Documentary",
      value: "Documentary",
    },
    {
      label: "Drama",
      value: "Drama",
    },
    {
      label: "Fashion & Beauty",
      value: "Fashion & Beauty",
    },
    {
      label: "Gaming",
      value: "Gaming",
    },
    {
      label: "Holiday Season",
      value: "Holiday Season",
    },
    {
      label: "Horror & Thriller",
      value: "Horror & Thriller",
    },
    {
      label: "Iconic Mentors",
      value: "Iconic Mentors",
    },
    {
      label: "Motivational & Inspiring",
      value: "Motivational & Inspiring",
    },
    {
      label: "Nature",
      value: "Nature",
    },
    {
      label: "Photography",
      value: "Photography",
    },
    {
      label: "Podcast",
      value: "Podcast",
    },
    {
      label: "Songs by BPM",
      value: "Songs by BPM",
    },
    {
      label: "Sports & Action",
      value: "Sports & Action",
    },
    {
      label: "Storytelling techniques",
      value: "Storytelling techniques",
    },
    {
      label: "Technology",
      value: "Technology",
    },
    {
      label: "Travel",
      value: "Travel",
    },
    {
      label: "Tutorials",
      value: "Tutorials",
    },
    {
      label: "Vibes",
      value: "Vibes",
    },
    {
      label: "Viral Trends & Aesthetics",
      value: "Viral Trends & Aesthetics",
    },
    {
      label: "Vlogs",
      value: "Vlogs",
    },
    {
      label: "Wedding & Romance",
      value: "Wedding & Romance",
    },
    {
      label: "Workout & Wellness",
      value: "Workout & Wellness",
    },
  ],
  fetchedAt: "2026-10-29",
  sources: [
    "https://developers.epidemicsound.com/docs/mcp/",
    "https://www.epidemicsound.com/music/genres/",
    "https://www.epidemicsound.com/music/moods/",
    "https://www.epidemicsound.com/music/themes/",
    "https://www.epidemicsound.com/sound-effects/",
  ],
};

/** Each consumer owns its arrays, so a dialog cannot mutate another tab's choices. */
export function epidemicCatalog(): EpidemicCatalog {
  return structuredClone(EPIDEMIC_CATALOG);
}
