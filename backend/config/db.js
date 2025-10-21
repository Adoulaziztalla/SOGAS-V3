// Fichier: backend/config/db.js

// Importation du module mysql2
const mysql = require('mysql2');

// Créer une connexion au pool de la base de données
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Exporter la connexion au pool pour qu'elle puisse être utilisée par d'autres fichiers
module.exports = pool.promise();