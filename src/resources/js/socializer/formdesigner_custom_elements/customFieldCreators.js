/*-------------------------
/  Component selection list
/-------------------------*/
export const customSocializerFieldTypes = {
    // your custom field creator
    ServerQuestionnaireList: {
        name: 'Liste des questionnaire d\'un server',
        creator: 'ServerQuestionnaireList-creator',
        config: {
            type: "ServerQuestionnaireList",
        }
    },
    AvailableRoomTypeList: {
        name: 'Liste des salons disponible pour un serveur',
        creator: 'AvailableRoomTypeList-creator',
        config: {
            type: "AvailableRoomTypeList",
        }
    },
}

// fields type that are ignored by the model
export const customSocializerIgnoredFields = []
