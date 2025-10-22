// Fichier: server.js

// Importation des modules nécessaires
const express = require('express');
const dotenv = require('dotenv');
const db = require('./config/db');
const authRoutes = require('./routes/auth/authRoutes');
const userRoutes = require('./routes/user/userRoutes');
const siteRoutes = require('./routes/structure/siteRoutes');
const employeeRoutes = require('./routes/employee/employeeRoutes'); // AJOUT: Importation des routes employé
const timeRoutes = require('./routes/time/timeRoutes'); // AJOUT: Importation des routes de temps
const hrRoutes = require('./routes/hr/hrRoutes');

// Charger les variables d'environnement du fichier .env
dotenv.config();

// Créer une instance de l'application Express
const app = express();

// Middleware pour analyser les requêtes JSON
app.use(express.json());

// Définir un port, en utilisant la variable d'environnement PORT si elle existe, sinon 3000
const PORT = process.env.PORT || 3000;

// Route de base pour tester le serveur
app.get('/', (req, res) => {
    res.status(200).json({ message: 'Serveur SOGAS-RH V2.0 en cours d\'exécution!' });
});

// Utiliser les routes d'authentification
app.use('/api/auth', authRoutes);

// Utiliser les routes utilisateur avec un chemin de base /api/user
app.use('/api/user', userRoutes);

// Utiliser les routes de structure avec un chemin de base /api/structure
app.use('/api/structure', siteRoutes);

// AJOUT: Utiliser les routes employé avec un chemin de base /api/employee
app.use('/api/employee', employeeRoutes);

// AJOUT: Utiliser les routes de temps avec un chemin de base /api/time
app.use('/api/time', timeRoutes);

app.use('/api/hr', hrRoutes);

// Démarrer le serveur et écouter les requêtes sur le port spécifié
app.listen(PORT, () => {
    console.log(`Le serveur est démarré sur le port ${PORT}`);
    
    // Test de la connexion à la base de données
    db.query('SELECT 1')
        .then(() => {
            console.log('Connexion à la base de données MySQL réussie !');
        })
        .catch(err => {
            console.error('Échec de la connexion à la base de données :', err);
        });
});