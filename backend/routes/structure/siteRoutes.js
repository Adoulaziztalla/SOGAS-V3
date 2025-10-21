// Fichier: backend/routes/structure/siteRoutes.js

const express = require('express');
const Joi = require('joi');
const db = require('../../config/db');
const authMiddleware = require('../../middleware/authMiddleware');

const router = express.Router();

// --- SCHÉMAS DE VALIDATION ---

// Schéma de validation pour la création d'un site
const siteSchema = Joi.object({
    nom: Joi.string().required(),
    code_site: Joi.string().max(50).required(),
    adresse: Joi.string().optional().allow(null, '')

});

    // Schéma de validation pour la création/modification d'un service
const serviceSchema = Joi.object({
    nom: Joi.string().required(),
    code_metier: Joi.string().max(50).required(),
    department_id: Joi.number().integer().min(1).required(), // CLÉ ÉTRANGÈRE : doit exister
    // Les autres champs (Chef, Missions, etc.) seront ajoutés plus tard pour simplifier le test initial

});

// Schéma de validation pour la création/modification d'un département
const departmentSchema = Joi.object({
    nom: Joi.string().required(),
    code_interne: Joi.string().max(50).required(),
    site_id: Joi.number().integer().min(1).required(), // CLÉ ÉTRANGÈRE : doit exister
    // responsable_id sera géré plus tard lors de la création d'employés
    budget_alloue: Joi.number().optional().allow(null, 0), // AJOUT selon cahier des charges [cite: 121]
    objectifs: Joi.string().optional().allow(null, '') // AJOUT selon cahier des charges [cite: 122]
});

// Schéma de validation pour la création/modification d'une équipe
const teamSchema = Joi.object({
    nom: Joi.string().required(),
    specialite: Joi.string().optional().allow(null, ''),
    service_id: Joi.number().integer().min(1).required(), // CLÉ ÉTRANGÈRE : doit exister
    // chef_equipe_id sera géré plus tard
});

// --- ROUTES CRUD SITES (Existant) ---

// Route pour créer un nouveau site (protégée)
router.post('/sites', authMiddleware, async (req, res) => {
    try {
        const { error, value } = siteSchema.validate(req.body);
        if (error) return res.status(400).json({ message: error.details[0].message });

        const [existingSite] = await db.query('SELECT code_site FROM sites WHERE code_site = ?', [value.code_site]);
        if (existingSite.length > 0) return res.status(409).json({ message: 'Un site avec ce code existe déjà.' });

        const [result] = await db.query('INSERT INTO sites (nom, code_site, adresse) VALUES (?, ?, ?)', [value.nom, value.code_site, value.adresse]);

        res.status(201).json({
            message: 'Site créé avec succès !',
            siteId: result.insertId
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Une erreur serveur est survenue.' });
    }
});


// --- ROUTES CRUD DÉPARTEMENTS (NOUVEAU) ---

// Route pour créer un nouveau département (protégée)
router.post('/departments', authMiddleware, async (req, res) => {
    try {
        const { error, value } = departmentSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        // 1. Vérification de la clé étrangère : le site_id doit exister
        const [siteRows] = await db.query('SELECT id FROM sites WHERE id = ?', [value.site_id]);
        if (siteRows.length === 0) {
            return res.status(404).json({ message: 'Le site d\'affectation spécifié (site_id) n\'existe pas.' });
        }

        // 2. Vérification de l'unicité du code interne du département
        const [existingDept] = await db.query('SELECT code_interne FROM departments WHERE code_interne = ?', [value.code_interne]);
        if (existingDept.length > 0) {
            return res.status(409).json({ message: 'Un département avec ce code interne existe déjà.' });
        }

        // 3. Insertion dans la base de données
        const sql = 'INSERT INTO departments (nom, code_interne, site_id, budget_alloue, objectifs) VALUES (?, ?, ?, ?, ?)';
        const params = [value.nom, value.code_interne, value.site_id, value.budget_alloue || 0, value.objectifs || null];
        const [result] = await db.query(sql, params);

        res.status(201).json({
            message: 'Département créé avec succès !',
            departmentId: result.insertId
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Une erreur serveur est survenue.' });
    }
});

// Route pour lire tous les départements (protégée)
router.get('/departments', authMiddleware, async (req, res) => {
    try {
        // Sélectionne les départements et joint le nom du site pour plus de clarté
        const sql = `
            SELECT 
                d.id, d.nom, d.code_interne, d.budget_alloue, d.objectifs,
                s.nom AS nom_site, s.code_site
            FROM departments d
            JOIN sites s ON d.site_id = s.id
            ORDER BY d.id DESC
        `;
        const [departments] = await db.query(sql);

        res.status(200).json(departments);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Une erreur serveur est survenue.' });
    }
});

// --- ROUTES CRUD SERVICES (NOUVEAU) ---

// Route pour créer un nouveau service (protégée)
router.post('/services', authMiddleware, async (req, res) => {
    try {
        const { error, value } = serviceSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        // 1. Vérification de la clé étrangère : le department_id doit exister
        const [deptRows] = await db.query('SELECT id FROM departments WHERE id = ?', [value.department_id]);
        if (deptRows.length === 0) {
            return res.status(404).json({ message: 'Le département parent spécifié (department_id) n\'existe pas.' });
        }

        // 2. Vérification de l'unicité du code métier
        const [existingService] = await db.query('SELECT code_metier FROM services WHERE code_metier = ?', [value.code_metier]);
        if (existingService.length > 0) {
            return res.status(409).json({ message: 'Un service avec ce code métier existe déjà.' });
        }

        // 3. Insertion dans la base de données
        const sql = 'INSERT INTO services (nom, code_metier, department_id) VALUES (?, ?, ?)';
        const params = [value.nom, value.code_metier, value.department_id];
        const [result] = await db.query(sql, params);

        res.status(201).json({
            message: 'Service créé avec succès !',
            serviceId: result.insertId
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Une erreur serveur est survenue.' });
    }
});

// Route pour lire tous les services (protégée)
router.get('/services', authMiddleware, async (req, res) => {
    try {
        const sql = `
            SELECT 
                s.id, s.nom, s.code_metier,
                d.nom AS nom_departement, d.code_interne AS code_departement
            FROM services s
            JOIN departments d ON s.department_id = d.id
            ORDER BY s.id DESC
        `;
        const [services] = await db.query(sql);

        res.status(200).json(services);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Une erreur serveur est survenue.' });
    }
});

// ... (Ajouter ici les routes Teams à l'étape suivante)

// module.exports = router; // Doit rester à la fin du fichier

// --- ROUTES CRUD ÉQUIPES (NOUVEAU) ---

// Route pour créer une nouvelle équipe (protégée)
router.post('/teams', authMiddleware, async (req, res) => {
    try {
        const { error, value } = teamSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        // 1. Vérification de la clé étrangère : le service_id doit exister
        const [serviceRows] = await db.query('SELECT id FROM services WHERE id = ?', [value.service_id]);
        if (serviceRows.length === 0) {
            return res.status(404).json({ message: 'Le service parent spécifié (service_id) n\'existe pas.' });
        }

        // 2. Insertion dans la base de données
        const sql = 'INSERT INTO teams (nom, specialite, service_id) VALUES (?, ?, ?)';
        const params = [value.nom, value.specialite || null, value.service_id];
        const [result] = await db.query(sql, params);

        res.status(201).json({
            message: 'Équipe créée avec succès !',
            teamId: result.insertId
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Une erreur serveur est survenue.' });
    }
});

// Route pour lire toutes les équipes (protégée)
router.get('/teams', authMiddleware, async (req, res) => {
    try {
        const sql = `
            SELECT 
                t.id, t.nom, t.specialite,
                s.nom AS nom_service, s.code_metier AS code_service
            FROM teams t
            JOIN services s ON t.service_id = s.id
            ORDER BY t.id DESC
        `;
        const [teams] = await db.query(sql);

        res.status(200).json(teams);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Une erreur serveur est survenue.' });
    }
});



module.exports = router;