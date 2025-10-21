// Fichier: backend/routes/user/userRoutes.js

const express = require('express');
const authMiddleware = require('../../middleware/authMiddleware');

const router = express.Router();

// Route d'exemple pour un profil utilisateur
// Notez l'utilisation de authMiddleware avant la fonction de la route
router.get('/profile', authMiddleware, (req, res) => {
    // Si cette ligne est atteinte, le jeton est valide
    res.status(200).json({
        message: 'Accès au profil autorisé !',
        user: req.user // Les informations de l'utilisateur sont attachées à la requête
    });
});

module.exports = router;