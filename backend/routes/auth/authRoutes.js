// Fichier: backend/routes/auth/authRoutes.js

    const express = require('express');
    const Joi = require('joi');
    const bcrypt = require('bcrypt');
    const db = require('../../config/db');
    const jwt = require('jsonwebtoken'); // AJOUT: Importation de jsonwebtoken

    const router = express.Router();

    // ... (Schéma de validation et route d'inscription existants)

    // Schéma de validation pour la connexion de l'utilisateur
    const loginSchema = Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().required()
    });

    // Route de connexion de l'utilisateur
    router.post('/login', async (req, res) => {
        try {
            // Valider les données de la requête
            const { error, value } = loginSchema.validate(req.body);
            if (error) {
                return res.status(400).json({ message: error.details[0].message });
            }

            // Chercher l'utilisateur dans la base de données
            const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [value.email]);
            const user = rows[0];

            if (!user) {
                return res.status(404).json({ message: 'Utilisateur non trouvé.' });
            }

            // Comparer le mot de passe fourni avec le mot de passe haché
            const passwordMatch = await bcrypt.compare(value.password, user.password);
            if (!passwordMatch) {
                return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
            }

            // Générer un JSON Web Token (JWT) pour l'utilisateur
            const token = jwt.sign(
                { id: user.id, email: user.email, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: '1h' } // Le jeton expire après 1 heure
            );

            // Renvoie le jeton au client
            res.status(200).json({
                message: 'Connexion réussie !',
                token: token,
                user: { id: user.id, email: user.email, role: user.role }
            });

        } catch (err) {
            console.error(err);
            res.status(500).json({ message: 'Une erreur serveur est survenue.' });
        }
    });

    module.exports = router;