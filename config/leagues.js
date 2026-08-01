module.exports = {
  ligas: {
    // ----- Ligas domésticas (principales) -----
    140: { nombre: 'La Liga', pais: 'España', codigo: 'ES', liga_principal: true },
    135: { nombre: 'Serie A', pais: 'Italia', codigo: 'IT', liga_principal: true },
    39:  { nombre: 'Premier League', pais: 'Inglaterra', codigo: 'GB', liga_principal: true },
    61:  { nombre: 'Ligue 1', pais: 'Francia', codigo: 'FR', liga_principal: true },
    78:  { nombre: 'Bundesliga', pais: 'Alemania', codigo: 'DE', liga_principal: true },
    141: { nombre: 'La Liga 2', pais: 'España', codigo: 'ES', liga_principal: true },
    136: { nombre: 'Serie B', pais: 'Italia', codigo: 'IT', liga_principal: true },
    40:  { nombre: 'Championship', pais: 'Inglaterra', codigo: 'GB', liga_principal: true },
    62:  { nombre: 'Ligue 2', pais: 'Francia', codigo: 'FR', liga_principal: true },
    79:  { nombre: '2. Bundesliga', pais: 'Alemania', codigo: 'DE', liga_principal: true },
    262: { nombre: 'Liga MX', pais: 'México', codigo: 'MX', liga_principal: true },
    253: { nombre: 'Major League Soccer', pais: 'Estados Unidos', codigo: 'US', liga_principal: true },
    71:  { nombre: 'Brasileirão Serie A', pais: 'Brasil', codigo: 'BR', liga_principal: true },
    72:  { nombre: 'Brasileirão Serie B', pais: 'Brasil', codigo: 'BR', liga_principal: true },

    // ----- Inglaterra (divisiones inferiores) -----
    41:  { nombre: 'League One', pais: 'Inglaterra', codigo: 'GB', liga_principal: true },
    42:  { nombre: 'League Two', pais: 'Inglaterra', codigo: 'GB', liga_principal: true },
    // 43: National League — API no provee estadísticas

    // ----- Francia (tercera división) -----
    // 63: National 1 — API no provee estadísticas

    // ----- Alemania -----
    80:  { nombre: '3. Liga', pais: 'Alemania', codigo: 'DE', liga_principal: true },

    // ----- Países Bajos -----
    88:  { nombre: 'Eredivisie', pais: 'Países Bajos', codigo: 'NL', liga_principal: true },
    89:  { nombre: 'Eerste Divisie', pais: 'Países Bajos', codigo: 'NL', liga_principal: true },

    // ----- Portugal -----
    94:  { nombre: 'Primeira Liga', pais: 'Portugal', codigo: 'PT', liga_principal: true },
    95:  { nombre: 'Segunda Liga', pais: 'Portugal', codigo: 'PT', liga_principal: true },

    // ----- Bélgica -----
    144: { nombre: 'Jupiler Pro League', pais: 'Bélgica', codigo: 'BE', liga_principal: true },
    145: { nombre: 'Challenger Pro League', pais: 'Bélgica', codigo: 'BE', liga_principal: true },

    // ----- Turquía -----
    203: { nombre: 'Süper Lig', pais: 'Turquía', codigo: 'TR', liga_principal: true },
    204: { nombre: '1. Lig', pais: 'Turquía', codigo: 'TR', liga_principal: true },

    // ----- Europa (mercados activos en casas de apuestas) -----
    179: { nombre: 'Scottish Premiership', pais: 'Escocia', codigo: 'GB', liga_principal: true },
    // 180: Scottish Championship — API no provee estadísticas
    // 183: Scottish League One — API no provee estadísticas
    // 184: Scottish League Two — API no provee estadísticas
    185: { nombre: 'Scottish League Cup', pais: 'Escocia', codigo: 'GB', liga_principal: false },
    218: { nombre: 'Bundesliga Austria', pais: 'Austria', codigo: 'AT', liga_principal: true },
    219: { nombre: '2. Liga Austria', pais: 'Austria', codigo: 'AT', liga_principal: true },
    119: { nombre: 'Superliga Dinamarca', pais: 'Dinamarca', codigo: 'DK', liga_principal: true },
    // 120: 1st Division Dinamarca — API no provee estadísticas
    207: { nombre: 'Swiss Super League', pais: 'Suiza', codigo: 'CH', liga_principal: true },
    // 208: Swiss Challenge League — API no provee estadísticas
    106: { nombre: 'Ekstraklasa', pais: 'Polonia', codigo: 'PL', liga_principal: true },
    // 107: I Liga Polonia — API no provee estadísticas
    113: { nombre: 'Allsvenskan', pais: 'Suecia', codigo: 'SE', liga_principal: true },
    114: { nombre: 'Superettan', pais: 'Suecia', codigo: 'SE', liga_principal: true },
    345: { nombre: 'Czech Liga', pais: 'República Checa', codigo: 'CZ', liga_principal: true },
    283: { nombre: 'Liga I', pais: 'Rumania', codigo: 'RO', liga_principal: true },
    244: { nombre: 'Veikkausliiga', pais: 'Finlandia', codigo: 'FI', liga_principal: true },
    357: { nombre: 'Premier Division', pais: 'Irlanda', codigo: 'IE', liga_principal: true },
    // 104: 1. Division Noruega — API no provee estadísticas
    // 164: Urvalsdeild Islandia — API no provee estadísticas
    172: { nombre: 'First League', pais: 'Bulgaria', codigo: 'BG', liga_principal: true },
    197: { nombre: 'Super League 1', pais: 'Grecia', codigo: 'GR', liga_principal: true },
    210: { nombre: 'HNL', pais: 'Croacia', codigo: 'HR', liga_principal: true },
    271: { nombre: 'NB I', pais: 'Hungría', codigo: 'HU', liga_principal: true },
    286: { nombre: 'Super Liga', pais: 'Serbia', codigo: 'RS', liga_principal: true },
    333: { nombre: 'Premier League', pais: 'Ucrania', codigo: 'UA', liga_principal: true },
    318: { nombre: '1. Division', pais: 'Chipre', codigo: 'CY', liga_principal: true },
    383: { nombre: "Ligat Ha'al", pais: 'Israel', codigo: 'IL', liga_principal: true },
    235: { nombre: 'Russian Premier League', pais: 'Rusia', codigo: 'RU', liga_principal: true },
    236: { nombre: 'Russian First League', pais: 'Rusia', codigo: 'RU', liga_principal: true },

    // ----- Australia, Asia y Norteamérica -----
    188: { nombre: 'A-League', pais: 'Australia', codigo: 'AU', liga_principal: true },
    292: { nombre: 'K League 1', pais: 'Corea del Sur', codigo: 'KR', liga_principal: true },
    293: { nombre: 'K League 2', pais: 'Corea del Sur', codigo: 'KR', liga_principal: true },
    307: { nombre: 'Saudi Pro League', pais: 'Arabia Saudita', codigo: 'SA', liga_principal: true },
    // 308: Saudi First Division — API no provee estadísticas
    288: { nombre: 'Premier Soccer League', pais: 'Sudáfrica', codigo: 'ZA', liga_principal: true },
    301: { nombre: 'Pro League', pais: 'Emiratos Árabes Unidos', codigo: 'AE', liga_principal: true },
    305: { nombre: 'Stars League', pais: 'Catar', codigo: 'QA', liga_principal: true },
    // 99: J2 League — API no provee estadísticas
    479: { nombre: 'Canadian Premier League', pais: 'Canadá', codigo: 'CA', liga_principal: true },
    256: { nombre: 'USL League Two', pais: 'Estados Unidos', codigo: 'US', liga_principal: true },

    // ----- México -----
    263: { nombre: 'Liga de Expansión MX', pais: 'México', codigo: 'MX', liga_principal: true },

    // ----- Sudamérica -----
    128: { nombre: 'Argentina Primera División', pais: 'Argentina', codigo: 'AR', liga_principal: true },
    134: { nombre: 'Torneo Federal A', pais: 'Argentina', codigo: 'AR', liga_principal: true },
    130: { nombre: 'Copa Argentina', pais: 'Argentina', codigo: 'AR', liga_principal: false },
    344: { nombre: 'Bolivia Primera División', pais: 'Bolivia', codigo: 'BO', liga_principal: true },
    265: { nombre: 'Chile Primera División', pais: 'Chile', codigo: 'CL', liga_principal: true },
    281: { nombre: 'Perú Primera División', pais: 'Perú', codigo: 'PE', liga_principal: true },
    250: { nombre: 'Paraguay División Profesional - Apertura', pais: 'Paraguay', codigo: 'PY', liga_principal: true },
    252: { nombre: 'Paraguay División Profesional - Clausura', pais: 'Paraguay', codigo: 'PY', liga_principal: true },
    239: { nombre: 'Colombia Primera A', pais: 'Colombia', codigo: 'CO', liga_principal: true },
    242: { nombre: 'Ecuador Liga Pro', pais: 'Ecuador', codigo: 'EC', liga_principal: true },
    268: { nombre: 'Uruguay Primera División', pais: 'Uruguay', codigo: 'UY', liga_principal: true },
    // 129: Argentina Primera Nacional — API no provee estadísticas
    // 240: Colombia Primera B — API no provee estadísticas
    75:  { nombre: 'Brasileirão Serie C', pais: 'Brasil', codigo: 'BR', liga_principal: true },
    73:  { nombre: 'Copa do Brasil', pais: 'Brasil', codigo: 'BR', liga_principal: false },
    13:  { nombre: 'CONMEBOL Libertadores', pais: 'Sudamérica', codigo: 'SA', liga_principal: false },
    11:  { nombre: 'CONMEBOL Sudamericana', pais: 'Sudamérica', codigo: 'SA', liga_principal: false },

    // ----- Asia / África / Otros -----
    103: { nombre: 'Eliteserien', pais: 'Noruega', codigo: 'NO', liga_principal: true },
    98:  { nombre: 'J1 League', pais: 'Japón', codigo: 'JP', liga_principal: true },
    169: { nombre: 'Chinese Super League', pais: 'China', codigo: 'CN', liga_principal: true },
    233: { nombre: 'Egyptian Premier League', pais: 'Egipto', codigo: 'EG', liga_principal: true },

    // ----- Fútbol femenil -----
    44:  { nombre: "Women's Super League", pais: 'Inglaterra', codigo: 'GB', liga_principal: true },
    142: { nombre: 'Liga F', pais: 'España', codigo: 'ES', liga_principal: true },
    64:  { nombre: 'Première Ligue Femenina', pais: 'Francia', codigo: 'FR', liga_principal: true },
    82:  { nombre: 'Frauen-Bundesliga', pais: 'Alemania', codigo: 'DE', liga_principal: true },
    139: { nombre: 'Serie A Women', pais: 'Italia', codigo: 'IT', liga_principal: true },
    // 190: A-League Women — API no provee estadísticas
    254: { nombre: 'NWSL', pais: 'Estados Unidos', codigo: 'US', liga_principal: true },
    549: { nombre: 'Damallsvenskan', pais: 'Suecia', codigo: 'SE', liga_principal: true },
    // 673: Liga MX Femenil — API no provee estadísticas
    // 74: Brasileirão Femenino — API no provee estadísticas

    // ----- Torneos internacionales -----
    1:   { nombre: 'FIFA World Cup', pais: 'Mundo', codigo: 'WW', liga_principal: false },
    4:   { nombre: 'UEFA Euro', pais: 'Europa', codigo: 'EU', liga_principal: false },
    9:   { nombre: 'Copa América', pais: 'Sudamérica', codigo: 'SA', liga_principal: false },
    536: { nombre: 'CONCACAF Nations League', pais: 'CONCACAF', codigo: 'MX', liga_principal: false },

    // ----- Ecosistema Norteamérica -----
    772: { nombre: 'Leagues Cup', pais: 'CONCACAF', codigo: 'MX', liga_principal: false },
    16:  { nombre: 'CONCACAF Champions League', pais: 'CONCACAF', codigo: 'MX', liga_principal: false },
    // 885: Campeones Cup — API no provee estadísticas
    // 255: USL Championship — API no provee estadísticas

    // ----- Copas domésticas de élite -----
    81:  { nombre: 'DFB-Pokal', pais: 'Alemania', codigo: 'DE', liga_principal: false },
    137: { nombre: 'Coppa Italia', pais: 'Italia', codigo: 'IT', liga_principal: false },
    66:  { nombre: 'Coupe de France', pais: 'Francia', codigo: 'FR', liga_principal: false },

    // ----- Ligas regionales América -----
    // 339: Liga Nacional Guatemala — API no provee estadísticas

    // ----- Competiciones de copa / Europa (no principales) -----
    2:   { nombre: 'UEFA Champions League', pais: 'Europa', codigo: 'EU', liga_principal: false },
    3:   { nombre: 'UEFA Europa League', pais: 'Europa', codigo: 'EU', liga_principal: false },
    848: { nombre: 'UEFA Europa Conference League', pais: 'Europa', codigo: 'EU', liga_principal: false },
    525: { nombre: 'UEFA Champions League Women', pais: 'Europa', codigo: 'EU', liga_principal: false },
    45:  { nombre: 'FA Cup', pais: 'Inglaterra', codigo: 'GB', liga_principal: false },
    143: { nombre: 'Copa del Rey', pais: 'España', codigo: 'ES', liga_principal: false }
  },

  equiposPorLiga: {
    262: {
      '2280': 'Club Tijuana', '2279': 'América', '2287': 'Monterrey', '2283': 'Cruz Azul',
      '2281': 'Toluca', '2282': 'Tigres UANL', '2286': 'Pachuca', '2288': 'Necaxa',
      '2278': 'Atlas', '2290': 'Chivas Guadalajara', '2284': 'Pumas UNAM', '2285': 'Santos Laguna',
      '2289': 'Atlético San Luis', '2291': 'FC Juárez', '2292': 'Mazatlán FC', '2293': 'Puebla',
      '2294': 'Querétaro', '2295': 'León'
    },
    39: {
      '42': 'Arsenal', '66': 'Aston Villa', '35': 'Bournemouth', '55': 'Brentford',
      '51': 'Brighton', '49': 'Chelsea', '52': 'Crystal Palace', '45': 'Everton',
      '36': 'Fulham', '57': 'Ipswich Town', '46': 'Leicester City', '40': 'Liverpool',
      '50': 'Manchester City', '33': 'Manchester United', '34': 'Newcastle United',
      '65': 'Nottingham Forest', '41': 'Southampton', '47': 'Tottenham',
      '48': 'West Ham', '39': 'Wolves'
    },
    140: {
      '529': 'Barcelona', '530': 'Atlético Madrid', '531': 'Athletic Club', '532': 'Sevilla',
      '533': 'Valencia', '534': 'Villarreal', '535': 'Real Sociedad', '536': 'Real Betis',
      '537': 'Celta Vigo', '538': 'Espanyol', '539': 'Getafe', '540': 'Osasuna',
      '541': 'Rayo Vallecano', '542': 'Mallorca', '543': 'Girona', '544': 'Alavés',
      '545': 'Las Palmas', '546': 'Leganés', '547': 'Valladolid'
    }
  },

  // Se usa para nuevas sincronizaciones. La API web toma la temporada más
  // reciente que exista en MongoDB para no mezclar campañas.
  seasonDefault: process.env.FOOTBALL_SEASON || '2024'
};
