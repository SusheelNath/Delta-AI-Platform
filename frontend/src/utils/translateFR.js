/**
 * French → English translation for IFC element names and properties.
 * Applied at display time since the XKT model contains original French text.
 */

// Full name overrides (exact match before partial replacement)
const NAME_OVERRIDES = {
  'Volume toiture technique': 'Rooftop',
};

// French → English construction/architecture vocabulary
const FR_EN = [
  // Structural
  ['Dalle béton', 'Concrete Slab'],
  ['Dalle de sol', 'Floor Slab'],
  ['Dalle', 'Slab'],
  ['Béton armé', 'Reinforced Concrete'],
  ['Béton', 'Concrete'],
  ['Fondation', 'Foundation'],
  ['Semelle', 'Footing'],
  ['Poteau', 'Column'],
  ['Poutre', 'Beam'],
  ['Pieu', 'Pile'],
  ['Plancher', 'Floor'],
  ['Radier', 'Raft Foundation'],
  ['Chainage', 'Ring Beam'],
  ['Longrine', 'Grade Beam'],
  ['Prédalle', 'Precast Slab'],
  ['Préfabriqué', 'Prefabricated'],

  // Walls & Partitions
  ['Mur extérieur', 'Exterior Wall'],
  ['Mur intérieur', 'Interior Wall'],
  ['Mur rideau', 'Curtain Wall'],
  ['Mur de soutènement', 'Retaining Wall'],
  ['Mur porteur', 'Load-bearing Wall'],
  ['Mur en béton', 'Concrete Wall'],
  ['Mur coupe-feu', 'Firewall'],
  ['Mur', 'Wall'],
  ['Cloison intérieure', 'Interior Partition'],
  ['Cloison vitrée', 'Glass Partition'],
  ['Cloison amovible', 'Movable Partition'],
  ['Cloison', 'Partition'],
  ['Cloisonnement intérieur', 'Interior Partitioning'],
  ['Paroi', 'Panel'],
  ['Voile béton', 'Concrete Shear Wall'],
  ['Voile', 'Shear Wall'],
  ['Bardage', 'Cladding'],

  // Roofing
  ['Toiture technique', 'Technical Roof'],
  ['Toiture terrasse', 'Flat Roof'],
  ['Toiture végétalisée', 'Green Roof'],
  ['Toiture', 'Roof'],
  ['Couverture', 'Roofing'],
  ['Étanchéité', 'Waterproofing'],
  ['Acrotère', 'Parapet'],
  ['Charpente', 'Roof Structure'],
  ['Chevron', 'Rafter'],
  ['Faîtage', 'Ridge'],
  ['Volume toiture', 'Roof Volume'],

  // Openings
  ['Porte coupe-feu', 'Fire Door'],
  ['Porte coulissante', 'Sliding Door'],
  ['Porte battante', 'Swing Door'],
  ['Porte vitrée', 'Glass Door'],
  ['Porte automatique', 'Automatic Door'],
  ['Porte double', 'Double Door'],
  ['Porte simple', 'Single Door'],
  ['Porte', 'Door'],
  ['Fenêtre', 'Window'],
  ['Châssis', 'Window Frame'],
  ['Vitrage', 'Glazing'],
  ['Baie vitrée', 'Bay Window'],
  ['Imposte', 'Transom'],
  ['Ouvrant', 'Opening Panel'],
  ['Menuiserie extérieure', 'External Joinery'],
  ['Menuiserie intérieure', 'Internal Joinery'],
  ['Menuiserie', 'Joinery'],

  // Stairs & Vertical
  ['Escalier préfabriqué', 'Prefabricated Staircase'],
  ['Escalier assemblé', 'Assembled Staircase'],
  ['Escalier secours', 'Emergency Staircase'],
  ['Escalier atrium', 'Atrium Staircase'],
  ['Escalier de secours', 'Emergency Staircase'],
  ['Escalier', 'Staircase'],
  ['Garde-corps', 'Railing'],
  ['Rampe', 'Ramp'],
  ['Marche', 'Step'],
  ['Palier', 'Landing'],
  ['Contremarche', 'Riser'],
  ['Main courante', 'Handrail'],
  ['Monte malades', 'Patient Lift'],
  ['Monte visiteur', 'Visitor Lift'],
  ['Monte-charge', 'Freight Elevator'],
  ['Ascenseur', 'Elevator'],
  ['Trémie', 'Shaft Opening'],

  // Rooms & Spaces
  ['Salle de réunion', 'Meeting Room'],
  ['Salle de reunion', 'Meeting Room'],
  ['Salle de bain', 'Bathroom'],
  ['Salle de soins', 'Treatment Room'],
  ['Salle de consultation', 'Consultation Room'],
  ['Salle d\'attente', 'Waiting Room'],
  ['Salle d\'opération', 'Operating Room'],
  ['Salle de réveil', 'Recovery Room'],
  ['Salle polyvalente', 'Multi-purpose Room'],
  ['Salle', 'Room'],
  ['Chambre patient', 'Patient Room'],
  ['Chambre double', 'Double Room'],
  ['Chambre individuelle', 'Single Room'],
  ['Chambre', 'Bedroom'],
  ['Bureau', 'Office'],
  ['Couloir', 'Corridor'],
  ['Hall d\'entrée', 'Entrance Hall'],
  ['Hall', 'Hall'],
  ['Accueil', 'Reception'],
  ['Vestiaire', 'Changing Room'],
  ['Local technique', 'Technical Room'],
  ['Local poubelle', 'Waste Room'],
  ['Local électrique', 'Electrical Room'],
  ['Local informatique', 'IT Room'],
  ['Local', 'Room'],
  ['Pièce', 'Room'],
  ['Piece', 'Room'],
  ['Sanitaire', 'Sanitary'],
  ['Toilette', 'Toilet'],
  ['WC', 'WC'],
  ['Cuisine', 'Kitchen'],
  ['Réserve', 'Storage'],
  ['Dépôt', 'Storage'],
  ['Magasin', 'Store'],
  ['Archive', 'Archive'],
  ['Lingerie', 'Linen Room'],
  ['Buanderie', 'Laundry'],
  ['Pharmacie', 'Pharmacy'],

  // Hospital / Medical
  ['Hôpital de jour chirurgical', 'Surgical Day Hospital'],
  ['Hôpital de jour médical', 'Medical Day Hospital'],
  ['Hôpital de jour', 'Day Hospital'],
  ['Hôpital', 'Hospital'],
  ['Hopital de jour chirurgical', 'Surgical Day Hospital'],
  ['Hopital de jour medical', 'Medical Day Hospital'],
  ['Urgence', 'Emergency'],
  ['Soins intensifs', 'Intensive Care'],
  ['Bloc opératoire', 'Operating Theatre'],
  ['Stérilisation', 'Sterilisation'],
  ['Radiothérapie', 'Radiotherapy'],
  ['Imagerie médicale', 'Medical Imaging'],
  ['Laboratoire', 'Laboratory'],
  ['Consultations', 'Consultations'],
  ['Maternité', 'Maternity'],
  ['Néonatalogie', 'Neonatology'],
  ['Pédiatrie', 'Paediatrics'],
  ['Gériatrie', 'Geriatrics'],
  ['Dialyse', 'Dialysis'],
  ['Endoscopie', 'Endoscopy'],
  ['Revalidation', 'Rehabilitation'],
  ['Kinésithérapie', 'Physiotherapy'],
  ['Ergothérapie', 'Occupational Therapy'],
  ['Isotope', 'Isotope'],

  // MEP / Technical
  ['Gaine technique', 'Service Shaft'],
  ['Gaine de ventilation', 'Ventilation Duct'],
  ['Gaine', 'Duct'],
  ['Conduit', 'Duct'],
  ['Tuyau', 'Pipe'],
  ['Canalisation', 'Piping'],
  ['Ventilation', 'Ventilation'],
  ['Climatisation', 'Air Conditioning'],
  ['Chauffage', 'Heating'],
  ['Plomberie', 'Plumbing'],
  ['Électricité', 'Electrical'],
  ['Éclairage', 'Lighting'],
  ['Sprinkler', 'Sprinkler'],
  ['Désenfumage', 'Smoke Extraction'],
  ['Groupe électrogène', 'Generator'],
  ['Tableau électrique', 'Electrical Panel'],
  ['Transformateur', 'Transformer'],

  // Finishes
  ['Faux-plafond', 'Suspended Ceiling'],
  ['Faux-plafonds', 'Suspended Ceilings'],
  ['Faux plafond', 'Suspended Ceiling'],
  ['Plafond suspendu', 'Suspended Ceiling'],
  ['Plafond', 'Ceiling'],
  ['Revêtement de sol', 'Floor Covering'],
  ['Revêtements de sol', 'Floor Coverings'],
  ['Revêtement mural', 'Wall Covering'],
  ['Revêtement', 'Covering'],
  ['Carrelage', 'Tiling'],
  ['Peinture', 'Paint'],
  ['Enduit', 'Plaster'],
  ['Isolation', 'Insulation'],
  ['Isolant', 'Insulation'],

  // Fire safety
  ['Compartimentage', 'Fire Compartmentation'],
  ['Coupe-feu', 'Fire-rated'],
  ['Protection incendie', 'Fire Protection'],
  ['Détection incendie', 'Fire Detection'],
  ['Extincteur', 'Fire Extinguisher'],

  // General construction terms
  ['Nouvelle construction', 'New Construction'],
  ['Structure verticale', 'Vertical Structure'],
  ['Structure métallique', 'Steel Structure'],
  ['Structure', 'Structure'],
  ['Assemblage', 'Assembly'],
  ['Ossature', 'Framework'],
  ['Chape', 'Screed'],
  ['Joint', 'Joint'],
  ['Seuil', 'Threshold'],
  ['Appui', 'Support'],
  ['Linteau', 'Lintel'],
  ['Nez de marche', 'Stair Nosing'],
  ['Noyau', 'Core'],
  ['Volume', 'Volume'],
  ['Niveau', 'Level'],
  ['Étage', 'Floor'],
  ['Sous-sol', 'Basement'],
  ['Rez-de-chaussée', 'Ground Floor'],
  ['Terrasse', 'Terrace'],
  ['Auvent', 'Canopy'],
  ['Passerelle', 'Walkway'],
  ['Quai', 'Platform'],
  ['Sol', 'Floor'],

  // Misc
  ['Pôle Mère Enfant', 'Mother & Child Unit'],
  ['Pole Mere Enfant', 'Mother & Child Unit'],
  ['Logistique', 'Logistics'],
  ['Technique', 'Technical'],
  ['Extérieur', 'Exterior'],
  ['Intérieur', 'Interior'],
  ['Général', 'General'],
  ['Principal', 'Main'],
  ['Secondaire', 'Secondary'],
  ['Provisoire', 'Temporary'],
  ['Existant', 'Existing'],
  ['Neuf', 'New'],
];

/**
 * Translate a French IFC name/description to English.
 * Checks exact overrides first, then applies partial replacements.
 */
export function translateFR(text) {
  if (!text || text === '--') return text;

  // Exact override
  if (NAME_OVERRIDES[text]) return NAME_OVERRIDES[text];

  let result = text;

  // Apply longest-match-first replacements (list is already ordered long→short)
  for (const [fr, en] of FR_EN) {
    if (result.includes(fr)) {
      result = result.split(fr).join(en);
    }
  }

  return result;
}
