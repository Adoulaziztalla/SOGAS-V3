// Fichier: server.js

// Importation des modules nécessaires
const express = require('express');
const dotenv = require('dotenv');
const db = require('./config/db');
const authRoutes = require('./routes/auth/authRoutes');
const userRoutes = require('./routes/user/userRoutes');
const siteRoutes = require('./routes/structure/siteRoutes'); // AJOUT: Importation des routes de site

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

// AJOUT: Utiliser les routes de structure avec un chemin de base /api/structure
app.use('/api/structure', siteRoutes);

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