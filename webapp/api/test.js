// api/test.js - Test endpoint for debugging
require('dotenv').config();
const axios = require('axios');

const SPACELIFT_API_URL = process.env.SPACELIFT_API_ENDPOINT;
const SPACELIFT_API_KEY_ID = process.env.SPACELIFT_API_KEY_ID;
const SPACELIFT_API_KEY_SECRET = process.env.SPACELIFT_API_KEY_SECRET;

let currentJWT = null;
let jwtExpiry = null;

async function getJWTToken() {
    if (currentJWT && jwtExpiry && Date.now() < jwtExpiry) {
        return currentJWT;
    }

    try {
        const response = await axios.post(SPACELIFT_API_URL, {
            query: `
                mutation GetSpaceliftToken($id: ID!, $secret: String!) {
                    apiKeyUser(id: $id, secret: $secret) {
                        jwt
                    }
                }
            `,
            variables: {
                id: SPACELIFT_API_KEY_ID,
                secret: SPACELIFT_API_KEY_SECRET
            }
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data.errors) {
            throw new Error(response.data.errors[0].message);
        }

        currentJWT = response.data.data.apiKeyUser.jwt;
        jwtExpiry = Date.now() + (50 * 60 * 1000);
        
        return currentJWT;
    } catch (error) {
        console.error('Failed to get JWT token:', error.response?.data || error.message);
        throw error;
    }
}

async function spaceliftQuery(query, variables = {}) {
    try {
        const jwt = await getJWTToken();
        
        const response = await axios.post(SPACELIFT_API_URL, {
            query,
            variables
        }, {
            headers: {
                'Authorization': `Bearer ${jwt}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.data.errors) {
            console.error('GraphQL errors:', response.data.errors);
            throw new Error(response.data.errors[0].message);
        }

        return response.data.data;
    } catch (error) {
        console.error('Spacelift API error:', error.response?.data || error.message);
        throw error;
    }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        const testQuery = `
            query {
                viewer {
                    id
                    name
                }
            }
        `;

        const viewerResult = await spaceliftQuery(testQuery);

        const blueprintQuery = `
            query {
                searchBlueprints(input: {}) {
                    edges {
                        node {
                            id
                            name
                            description
                            state
                        }
                    }
                }
            }
        `;

        const blueprintResult = await spaceliftQuery(blueprintQuery);

        return res.json({
            success: true,
            viewer: viewerResult.viewer,
            blueprints: blueprintResult.searchBlueprints.edges.map(edge => edge.node),
            environment: {
                SPACELIFT_API_ENDPOINT: SPACELIFT_API_URL ? '✓ Set' : '✗ Missing',
                SPACELIFT_API_KEY_ID: SPACELIFT_API_KEY_ID ? '✓ Set' : '✗ Missing',
                SPACELIFT_API_KEY_SECRET: SPACELIFT_API_KEY_SECRET ? '✓ Set' : '✗ Missing'
            }
        });

    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message,
            environment: {
                SPACELIFT_API_ENDPOINT: SPACELIFT_API_URL ? '✓ Set' : '✗ Missing',
                SPACELIFT_API_KEY_ID: SPACELIFT_API_KEY_ID ? '✓ Set' : '✗ Missing',
                SPACELIFT_API_KEY_SECRET: SPACELIFT_API_KEY_SECRET ? '✓ Set' : '✗ Missing'
            }
        });
    }
};
