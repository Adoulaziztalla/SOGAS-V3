// Fichier: backend/routes/admin/adminRoutes.js

const express = require('express');
const Joi = require('joi');
const db = require('../../config/db');
const authMiddleware = require('../../middleware/authMiddleware');

const router = express.Router();

// Schéma de validation pour l'ajout d'un document RH
const documentSchema = Joi.object({
    employee_id: Joi.number().integer().min(1).required(),
    type_document: Joi.string().max(100).required(),
    nom_fichier: Joi.string().max(255).required(),
    chemin_stockage: Joi.string().max(255).required(), // Chemin ou URL du document
    date_enregistrement: Joi.date().iso().default(new Date().toISOString().split('T')[0]),
    date_expiration: Joi.date().iso().allow(null).optional(),
    statut_alerte: Joi.string().valid('OK', 'Expiration 30j', 'Expiré').default('OK')
});

/**
 * Route pour ajouter un document à la bibliothèque RH.
 * POST /api/admin/documents
 */
router.post('/documents', authMiddleware, async (req, res) => {
    const connection = await db.getConnection();
    await connection.beginTransaction();
    
    try {
        const { error, value } = documentSchema.validate(req.body);
        if (error) {
            await connection.rollback();
            return res.status(400).json({ message: error.details[0].message });
        }
        
        // 1. Vérification : l'employé doit exister
        const [empRows] = await connection.query('SELECT id FROM employees WHERE id = ?', [value.employee_id]);
        if (empRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Employé non trouvé.' });
        }

        // 2. Insertion du document
        const [result] = await connection.query(`
            INSERT INTO documents (
                employee_id, type_document, nom_fichier, chemin_stockage, 
                date_enregistrement, date_expiration, statut_alerte, created_by_user_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            value.employee_id, value.type_document, value.nom_fichier, value.chemin_stockage,
            value.date_enregistrement, value.date_expiration || null, value.statut_alerte, req.user.id
        ]);
        
        const documentId = result.insertId;

        await connection.commit();

        res.status(201).json({
            message: `Document "${value.type_document}" enregistré avec succès.`,
            documentId: documentId
        });

    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ message: 'Erreur serveur lors de l\'enregistrement du document.' });
    } finally {
        connection.release();
    }
});


// Schéma de validation pour l'ajout d'une alerte
const alertSchema = Joi.object({
    type_alerte: Joi.string().max(50).required(),
    message_detaille: Joi.string().required(),
    employee_id: Joi.number().integer().min(1).allow(null).optional(),
    date_echeance: Joi.date().iso().allow(null).optional(),
    gravite: Joi.string().valid('Basse', 'Moyenne', 'Haute', 'Critique').default('Moyenne'),
    statut: Joi.string().valid('Ouvert', 'En cours', 'Fermé').default('Ouvert')
});

/**
 * Route pour créer une alerte manuelle ou automatique.
 * POST /api/admin/alerts
 */
router.post('/alerts', authMiddleware, async (req, res) => {
    const connection = await db.getConnection();
    await connection.beginTransaction();
    
    try {
        const { error, value } = alertSchema.validate(req.body);
        if (error) {
            await connection.rollback();
            return res.status(400).json({ message: error.details[0].message });
        }
        
        // 1. Vérification optionnelle : l'employé existe si l'ID est fourni
        if (value.employee_id) {
            const [empRows] = await connection.query('SELECT id FROM employees WHERE id = ?', [value.employee_id]);
            if (empRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ message: 'Employé spécifié pour l\'alerte non trouvé.' });
            }
        }

        // 2. Insertion de l'alerte
        const [result] = await connection.query(`
            INSERT INTO alerts (
                type_alerte, message_detaille, employee_id, date_echeance, gravite, statut, assignee_user_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            value.type_alerte, value.message_detaille, value.employee_id, value.date_echeance || null,
            value.gravite, value.statut, req.user.id // L'utilisateur connecté est l'assigné par défaut
        ]);
        
        const alertId = result.insertId;

        await connection.commit();

        res.status(201).json({
            message: `Alerte de type "${value.type_alerte}" créée avec succès.`,
            alertId: alertId
        });

    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ message: 'Erreur serveur lors de la création de l\'alerte.' });
    } finally {
        connection.release();
    }
});


module.exports = router;