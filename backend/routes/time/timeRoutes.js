// Fichier: backend/routes/time/timeRoutes.js

const express = require('express');
const Joi = require('joi');
const db = require('../../config/db');
const authMiddleware = require('../../middleware/authMiddleware');

const router = express.Router();

// Schéma de validation pour l'ajout d'un jour férié
const ferieSchema = Joi.object({
    nom: Joi.string().required(),
    date_feriee: Joi.date().iso().required(),
    type: Joi.string().valid('Fixe', 'Variable', 'Religieux', 'SOGAS').default('Fixe'),
    recurrent: Joi.boolean().default(false),
    majoration_pourcentage: Joi.number().min(0).max(100).default(60.00), // Standard Sénégal
    actif: Joi.boolean().default(true)
});

// Schéma de validation pour le pointage d'entrée
const checkinSchema = Joi.object({
    employee_id: Joi.number().integer().min(1).required(),
    heure_entree: Joi.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(), // Format HH:MM
    date_pointage: Joi.date().iso().default(new Date().toISOString().split('T')[0]), // Par défaut aujourd'hui
    source: Joi.string().max(50).default('Manuel')
});

// Schéma de validation pour le pointage de sortie (update)
const checkoutSchema = Joi.object({
    heure_sortie: Joi.string().regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).required(), // Format HH:MM
});

// Fonction utilitaire pour calculer les heures travaillées (Logique SOGAS VRAIE)
const calculateHours = (heure_entree, heure_sortie, isHoliday, isSunday, majorationFeriee) => {
    // Convertir l'heure 'HH:MM' en minutes depuis minuit
    const timeToMinutes = (time) => {
        const [hours, minutes] = time.split(':').map(Number);
        return hours * 60 + minutes;
    };

    const totalMinutes = timeToMinutes(heure_sortie) - timeToMinutes(heure_entree);
    const totalHours = totalMinutes / 60; // Heures décimales

    // Arrondi au quart d'heure supérieur pour le temps total
    const totalHoursRounded = Math.ceil(totalHours * 4) / 4;
    
    // Heures normales = 8h par jour selon SOGAS
    const baseNormalHours = 8.0; 
    let normalHours = Math.min(totalHoursRounded, baseNormalHours);
    let overtimeHours = Math.max(0, totalHoursRounded - baseNormalHours);
    
    let majoration = 0.00;
    let panierRepas = totalHoursRounded >= 10; // Panier repas si ≥10h/jour
    
    // --- Logique de Majoration ---
    if (isHoliday && isSunday) {
        // Dimanche ET Férié: +100% salaire horaire
        majoration = 100.00;
        overtimeHours = totalHoursRounded; // Toutes les heures sont majorées à 100%
        normalHours = 0.00;
    } else if (isHoliday) {
        // Jour Férié (seul): Utiliser la majoration configurée (par défaut +60%)
        majoration = majorationFeriee;
        overtimeHours = totalHoursRounded; // Toutes les heures sont majorées à 60%
        normalHours = 0.00;
    } else if (isSunday) {
        // Dimanche (seul): +60% salaire horaire
        majoration = 60.00;
        overtimeHours = totalHoursRounded; // Toutes les heures sont majorées à 60%
        normalHours = 0.00;
    } else {
        // Jours normaux (Lundi - Samedi)
        
        // Tranche 1: +15% (Premières heures au-delà de 8h - Logique journalière simplifiée)
        const overtime15 = Math.min(overtimeHours, 2.0); // Les premières 2h au-delà de 8h
        
        // Tranche 2: +40% (Au-delà de ces heures - Logique journalière simplifiée)
        const overtime40 = Math.max(0, overtimeHours - 2.0);
        
        // On renvoie les heures supplémentaires séparément
        return {
            totalHours: totalHoursRounded,
            heures_normales: parseFloat(normalHours.toFixed(2)),
            heures_sup_15: parseFloat(overtime15.toFixed(2)),
            heures_sup_40: parseFloat(overtime40.toFixed(2)),
            heures_supplementaires: parseFloat((overtime15 + overtime40).toFixed(2)), // Total des heures sup (15% + 40%)
            majoration_pourcentage: 0.00, // Pas de majoration unique ici
            panierRepas: panierRepas
        };
    }
    
    // Cas Jours Fériés/Dimanche (Majoration unique)
    return {
        totalHours: totalHoursRounded,
        heures_normales: parseFloat(normalHours.toFixed(2)),
        heures_sup_15: 0.00,
        heures_sup_40: 0.00,
        heures_supplementaires: parseFloat(overtimeHours.toFixed(2)),
        majoration_pourcentage: parseFloat(majoration.toFixed(2)),
        panierRepas: panierRepas
    };
};


// --- ROUTES JOURS FÉRIÉS (EXISTANTES) ---

// Route pour ajouter un nouveau jour férié (POST /api/time/feries)
router.post('/feries', authMiddleware, async (req, res) => {
    try {
        const { error, value } = ferieSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        const [existing] = await db.query('SELECT id FROM jours_feries WHERE date_feriee = ?', [value.date_feriee]);
        if (existing.length > 0) {
            return res.status(409).json({ message: 'Un jour férié est déjà enregistré à cette date.' });
        }

        const sql = 'INSERT INTO jours_feries (nom, date_feriee, type, recurrent, majoration_pourcentage, actif) VALUES (?, ?, ?, ?, ?, ?)';
        const params = [value.nom, value.date_feriee, value.type, value.recurrent, value.majoration_pourcentage, value.actif];
        const [result] = await db.query(sql, params);

        res.status(201).json({
            message: 'Jour férié ajouté avec succès.',
            ferieId: result.insertId
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erreur serveur lors de l\'ajout du jour férié.' });
    }
});

// Route pour lire tous les jours fériés actifs (GET /api/time/feries)
router.get('/feries', authMiddleware, async (req, res) => {
    try {
        const [feries] = await db.query('SELECT * FROM jours_feries WHERE actif = TRUE ORDER BY date_feriee ASC');
        res.status(200).json(feries);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erreur serveur lors de la récupération des jours fériés.' });
    }
});


// --- ROUTES POINTAGE (ATTENDANCE) ---

// Route pour le pointage d'ENTRÉE (POST /api/time/checkin)
router.post('/checkin', authMiddleware, async (req, res) => {
    try {
        const { error, value } = checkinSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }
        
        // 1. Vérification : l'employé doit être Actif
        const [empRows] = await db.query('SELECT id FROM employees WHERE id = ? AND statut = "Actif"', [value.employee_id]);
        if (empRows.length === 0) {
            return res.status(404).json({ message: 'Employé actif non trouvé.' });
        }

        // 2. Vérification : pointage déjà enregistré pour aujourd'hui (indice d'unicité)
        const [existing] = await db.query('SELECT id FROM attendances WHERE employee_id = ? AND date_pointage = ?', [value.employee_id, value.date_pointage]);
        if (existing.length > 0) {
            return res.status(409).json({ message: 'Un pointage d\'entrée est déjà enregistré pour cet employé aujourd\'hui.' });
        }

        // 3. Insertion du pointage d'entrée
        const sql = 'INSERT INTO attendances (employee_id, date_pointage, heure_entree, source) VALUES (?, ?, ?, ?)';
        const params = [value.employee_id, value.date_pointage, value.heure_entree, value.source];
        const [result] = await db.query(sql, params);

        res.status(201).json({
            message: 'Pointage d\'entrée enregistré avec succès.',
            attendanceId: result.insertId
        });
        
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erreur serveur lors de l\'enregistrement du pointage.' });
    }
});


// Route pour le pointage de SORTIE (PUT /api/time/checkout/:employeeId)
router.put('/checkout/:employeeId', authMiddleware, async (req, res) => {
    const employeeId = req.params.employeeId;
    const dateToday = new Date().toISOString().split('T')[0];
    const dayOfWeek = new Date().getDay(); // 0 = Dimanche, 1 = Lundi, etc.
    
    try {
        const { error, value } = checkoutSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ message: error.details[0].message });
        }

        // 1. Récupérer le pointage d'entrée non complété pour AUJOURD'HUI
        const [attendanceRows] = await db.query(
            'SELECT * FROM attendances WHERE employee_id = ? AND date_pointage = ? AND heure_sortie IS NULL',
            [employeeId, dateToday]
        );

        if (attendanceRows.length === 0) {
            return res.status(404).json({ message: 'Pointage d\'entrée manquant ou déjà complété pour aujourd\'hui.' });
        }
        
        const attendance = attendanceRows[0];
        
        // 2. Vérification Jours Fériés et Dimanche
        const isSunday = (dayOfWeek === 0);
        
        // Récupère la majoration si le jour est férié
        const [ferieRows] = await db.query('SELECT majoration_pourcentage FROM jours_feries WHERE date_feriee = ? AND actif = TRUE', [dateToday]);
        const isHoliday = ferieRows.length > 0;
        const majorationFeriee = isHoliday ? ferieRows[0].majoration_pourcentage : 0.00;
        
        
        // 3. Calculer les heures travaillées avec les règles SOGAS
        const calculatedHours = calculateHours(attendance.heure_entree, value.heure_sortie, isHoliday, isSunday, majorationFeriee);
        
        // 4. Mettre à jour le pointage de sortie et les heures calculées
        const sql = `
            UPDATE attendances
            SET heure_sortie = ?, 
                heures_normales = ?, 
                heures_sup_15 = ?,
                heures_sup_40 = ?,
                heures_sup_hors_majoration = ?,
                majoration_pourcentage = ?,
                panier_repas_du = ?
            WHERE id = ?
        `;
        const params = [
            value.heure_sortie, 
            calculatedHours.heures_normales, 
            calculatedHours.heures_sup_15,
            calculatedHours.heures_sup_40,
            calculatedHours.heures_supplementaires,
            calculatedHours.majoration_pourcentage,
            calculatedHours.panierRepas,
            attendance.id
        ];
        
        await db.query(sql, params);

        res.status(200).json({
            message: 'Pointage de sortie enregistré et heures calculées avec succès (Règles SOGAS appliquées).',
            totalHours: calculatedHours.totalHours,
            heures_normales: calculatedHours.heures_normales,
            heures_sup_15: calculatedHours.heures_sup_15,
            heures_sup_40: calculatedHours.heures_sup_40,
            majoration_pourcentage_speciale: calculatedHours.majoration_pourcentage,
            panier_repas_du: calculatedHours.panierRepas
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Erreur serveur lors de l\'enregistrement du pointage de sortie.' });
    }
});

// Fichier: backend/routes/time/timeRoutes.js (Ajouts)

// ... (Routes existantes pour Jours Fériés et Pointage)

// Schéma de validation pour une nouvelle demande de congés
const leaveRequestSchema = Joi.object({
    employee_id: Joi.number().integer().min(1).required(),
    type_conge: Joi.string().max(50).required(),
    date_debut: Joi.date().iso().min('now').required(), // Ne peut pas être dans le passé
    date_fin: Joi.date().iso().min(Joi.ref('date_debut')).required(), // Doit être après le début
    nb_jours: Joi.number().min(0.5).required(), // Minimum 0.5 jour
    motif_employe: Joi.string().allow(null, '').optional(),
});

// Route pour soumettre une nouvelle demande de congés (POST /api/time/leaves)
router.post('/leaves', authMiddleware, async (req, res) => {
    const connection = await db.getConnection();
    await connection.beginTransaction();
    
    try {
        const { error, value } = leaveRequestSchema.validate(req.body);
        if (error) {
            await connection.rollback();
            return res.status(400).json({ message: error.details[0].message });
        }
        
        // 1. Vérification : l'employé doit être Actif
        const [empRows] = await connection.query('SELECT id FROM employees WHERE id = ? AND statut = "Actif"', [value.employee_id]);
        if (empRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Employé actif non trouvé. Impossible de soumettre la demande.' });
        }
        
        // 2. Vérification : chevauchement des dates avec les demandes soumises/approuvées
        const [overlap] = await connection.query(`
            SELECT id FROM leave_requests 
            WHERE employee_id = ? AND statut_actuel IN ('Soumis', 'En attente', 'Approuvé')
            AND (
                (? BETWEEN date_debut AND date_fin) OR
                (? BETWEEN date_debut AND date_fin) OR
                (date_debut BETWEEN ? AND ?)
            )
        `, [value.employee_id, value.date_debut, value.date_fin, value.date_debut, value.date_fin]);

        if (overlap.length > 0) {
            await connection.rollback();
            return res.status(409).json({ message: 'Une demande de congés (soumise ou approuvée) existe déjà sur cette période.' });
        }

        // 3. Insertion de la demande (statut par défaut 'Soumis')
        const [result] = await connection.query(`
            INSERT INTO leave_requests (employee_id, type_conge, date_debut, date_fin, nb_jours, motif_employe)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [value.employee_id, value.type_conge, value.date_debut, value.date_fin, value.nb_jours, value.motif_employe || null]);

        const requestId = result.insertId;

        // 4. Initialisation de la première étape du workflow (Traçabilité)
        await connection.query(`
            INSERT INTO leave_validations (request_id, validateur_id, niveau_validation, decision, commentaire)
            VALUES (?, ?, ?, ?, ?)
        `, [requestId, req.user.id, 'Soumission Employé', 'En attente', 'Demande soumise par l\'employé.']);

        await connection.commit();

        res.status(201).json({
            message: 'Demande de congés soumise avec succès. Workflow de validation démarré.',
            requestId: requestId
        });

    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ message: 'Erreur serveur lors de la soumission de la demande de congés.' });
    } finally {
        connection.release();
    }
});


module.exports = router;