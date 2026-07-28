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

    // ----- Sudamérica -----
    128: { nombre: 'Argentina Primera División', pais: 'Argentina', codigo: 'AR', liga_principal: true },
    130: { nombre: 'Bolivia Primera División', pais: 'Bolivia', codigo: 'BO', liga_principal: true },
    265: { nombre: 'Chile Primera División', pais: 'Chile', codigo: 'CL', liga_principal: true },
    242: { nombre: 'Peru Primera División', pais: 'Perú', codigo: 'PE', liga_principal: true },
    239: { nombre: 'Paraguay Primera División', pais: 'Paraguay', codigo: 'PY', liga_principal: true },
    13:  { nombre: 'CONMEBOL Libertadores', pais: 'Sudamérica', codigo: 'SA', liga_principal: false },
    11:  { nombre: 'CONMEBOL Sudamericana', pais: 'Sudamérica', codigo: 'SA', liga_principal: false },

    // ----- Asia / África / Otros -----
    103: { nombre: 'Eliteserien', pais: 'Noruega', codigo: 'NO', liga_principal: true },
    98:  { nombre: 'J1 League', pais: 'Japón', codigo: 'JP', liga_principal: true },
    169: { nombre: 'Chinese Super League', pais: 'China', codigo: 'CN', liga_principal: true },
    233: { nombre: 'Egyptian Premier League', pais: 'Egipto', codigo: 'EG', liga_principal: true },

    // ----- Competiciones de copa / Europa (no principales) -----
    2:   { nombre: 'UEFA Champions League', pais: 'Europa', codigo: 'EU', liga_principal: false },
    3:   { nombre: 'UEFA Europa League', pais: 'Europa', codigo: 'EU', liga_principal: false },
    848: { nombre: 'UEFA Europa Conference League', pais: 'Europa', codigo: 'EU', liga_principal: false },
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
