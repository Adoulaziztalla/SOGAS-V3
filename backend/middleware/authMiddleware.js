// Fichier: backend/middleware/authMiddleware.js

const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    // Tenter de récupérer le jeton du header 'Authorization'
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN"

    // Si aucun jeton n'est présent, renvoyer une erreur 401 Unauthorized
    if (token == null) {
        return res.status(401).json({ message: 'Accès non autorisé. Jeton manquant.' });
    }

    try {
        // Vérifier le jeton avec la clé secrète
        const decodedToken = jwt.verify(token, process.env.JWT_SECRET);

        // Attacher les informations de l'utilisateur à l'objet de la requête
        req.user = decodedToken;

        // Passer au prochain middleware ou à la route finale
        next();
    } catch (err) {
        // Si la vérification du jeton échoue (jeton invalide ou expiré), renvoyer une erreur 403 Forbidden
        return res.status(403).json({ message: 'Jeton invalide ou expiré.' });
    }
};

module.exports = authMiddleware;