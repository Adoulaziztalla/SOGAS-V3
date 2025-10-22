// Fichier: backend/routes/hr/hrRoutes.js

const express = require('express');
const Joi = require('joi');
const db = require('../../config/db');
const authMiddleware = require('../../middleware/authMiddleware');

const router = express.Router();

// Schéma de validation pour l'ajout/avenant de contrat
const contractSchema = Joi.object({
    employee_id: Joi.number().integer().min(1).required(),
    type_contrat: Joi.string().valid('CDI', 'CDD', 'Stage', 'Consultant', 'Saisonnier', 'Apprentissage').required(), // Types SOGAS
    date_debut: Joi.date().iso().required(),
    date_fin_prevue: Joi.date().iso().min(Joi.ref('date_debut')).allow(null).when('type_contrat', {
        is: 'CDI', 
        then: Joi.valid(null) // CDI n'a pas de date de fin
    }),
    position_id: Joi.number().integer().min(1).required(),
    salaire_de_base: Joi.number().min(0).required(),
    notes_rh: Joi.string().allow(null, '').optional(),
    document_url: Joi.string().uri().allow(null, '').optional(),
    is_avenant: Joi.boolean().default(false),
    parent_contract_id: Joi.number().integer().min(1).allow(null).when('is_avenant', {
        is: true,
        then: Joi.required() // Si avenant, l'ID du contrat parent est obligatoire
    })
});

/**
 * Route pour ajouter un nouveau contrat ou un avenant.
 * POST /api/hr/contracts
 */
router.post('/contracts', authMiddleware, async (req, res) => {
    const connection = await db.getConnection();
    await connection.beginTransaction();
    
    try {
        const { error, value } = contractSchema.validate(req.body);
        if (error) {
            await connection.rollback();
            return res.status(400).json({ message: error.details[0].message });
        }
        
        // 1. Vérification : l'employé doit exister et être actif
        const [empRows] = await connection.query('SELECT id FROM employees WHERE id = ? AND statut = "Actif"', [value.employee_id]);
        if (empRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Employé actif non trouvé.' });
        }

        // 2. Si ce n'est PAS un avenant, vérifier s'il existe déjà un contrat actif
        if (!value.is_avenant) {
            const [activeContracts] = await connection.query(
                'SELECT id FROM contracts WHERE employee_id = ? AND statut = "Actif" AND is_avenant = FALSE',
                [value.employee_id]
            );
            
            // Si un contrat principal actif existe, il faut d'abord le terminer
            if (activeContracts.length > 0) {
                await connection.rollback();
                return res.status(409).json({ message: 'Un contrat principal est déjà ACTIF pour cet employé. Veuillez le terminer avant d\'en ajouter un nouveau.' });
            }
        }

        // 3. Insertion du nouveau contrat ou avenant
        const [result] = await connection.query(`
            INSERT INTO contracts (
                employee_id, type_contrat, date_debut, date_fin_prevue, position_id, 
                salaire_de_base, notes_rh, document_url, is_avenant, parent_contract_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            value.employee_id, value.type_contrat, value.date_debut, value.date_fin_prevue, value.position_id,
            value.salaire_de_base, value.notes_rh, value.document_url, value.is_avenant, value.parent_contract_id
        ]);
        
        const contractId = result.insertId;

        // 4. Si ce n'est PAS un avenant, mettre à jour la classification dans la table employees (simplifié)
        if (!value.is_avenant) {
            await connection.query('UPDATE employees SET position_id = ? WHERE id = ?', [value.position_id, value.employee_id]);
        }

        await connection.commit();

        res.status(201).json({
            message: `Contrat de type ${value.type_contrat} enregistré avec succès.`,
            contractId: contractId
        });

    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ message: 'Erreur serveur lors de l\'enregistrement du contrat.' });
    } finally {
        connection.release();
    }
});

// Fichier: backend/routes/hr/hrRoutes.js (AJOUTER LE CODE SUIVANT)

// ... (Les imports express, Joi, db, authMiddleware et la route /contracts sont au-dessus)

// Schéma de validation pour l'ajout d'une sanction disciplinaire
const sanctionSchema = Joi.object({
    employee_id: Joi.number().integer().min(1).required(),
    // Types SOGAS: Avertissement oral/écrit, Blâme, Mise à pied, Rétrogradation, Licenciement
    type_sanction: Joi.string().valid(
        'Avertissement oral', 
        'Avertissement écrit', 
        'Blâme', 
        'Mise à pied', 
        'Rétrogradation', 
        'Licenciement'
    ).required(),
    date_constatation: Joi.date().iso().required(),
    date_effet: Joi.date().iso().min(Joi.ref('date_constatation')).required(),
    jours_mise_a_pied: Joi.number().integer().min(0).max(30).default(0).when('type_sanction', {
        is: 'Mise à pied',
        then: Joi.number().integer().min(1).required() // Doit spécifier les jours si c'est une mise à pied
    }),
    motif_detaille: Joi.string().min(10).required(),
    procedure_suivie: Joi.string().max(255).optional().allow(null, ''),
    document_url: Joi.string().uri().max(255).optional().allow(null, ''),
    // created_by_user_id est injecté par req.user.id
});

/**
 * Route pour enregistrer une sanction disciplinaire.
 * POST /api/hr/sanctions
 */
router.post('/sanctions', authMiddleware, async (req, res) => {
    const connection = await db.getConnection();
    await connection.beginTransaction();
    
    try {
        const { error, value } = sanctionSchema.validate(req.body);
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

        // 2. Insertion de la sanction
        const [result] = await connection.query(`
            INSERT INTO sanctions (
                employee_id, type_sanction, date_constatation, date_effet, 
                jours_mise_a_pied, motif_detaille, procedure_suivie, document_url, created_by_user_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            value.employee_id, value.type_sanction, value.date_constatation, value.date_effet,
            value.jours_mise_a_pied, value.motif_detaille, value.procedure_suivie, value.document_url, req.user.id // Injecté par authMiddleware
        ]);
        
        const sanctionId = result.insertId;

        // 3. Logique spéciale pour le Licenciement (Mettre l'employé à statut 'Licencié')
        if (value.type_sanction === 'Licenciement') {
            await connection.query('UPDATE employees SET statut = "Licencié", date_fin_contrat = ? WHERE id = ?', [value.date_effet, value.employee_id]);
        }
        
        // (A VENIR : Logique pour Mise à pied, Rétrogradation...)

        await connection.commit();

        res.status(201).json({
            message: `Sanction de type "${value.type_sanction}" enregistrée avec succès.`,
            sanctionId: sanctionId
        });

    } catch (err) {
        await connection.rollback();
        console.error(err);
        res.status(500).json({ message: 'Erreur serveur lors de l\'enregistrement de la sanction.' });
    } finally {
        connection.release();
    }
});

// Assurez-vous que cette ligne est à la fin du fichier:
// module.exports = router;

module.exports = router;