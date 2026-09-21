import { Router, Request, Response } from 'express';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import path from 'path';
import fs from 'fs';

const router = Router();

const openApiPath = path.resolve(__dirname, '../../../docs/openapi.yaml');

let swaggerDocument: any;
try {
  swaggerDocument = YAML.load(openApiPath);
} catch {
  swaggerDocument = {
    openapi: '3.0.3',
    info: { title: 'Amrutam Telemedicine Backend API', version: '1.0.0' },
    paths: {},
  };
}

/**
 * Raw OpenAPI JSON specification
 */
router.get('/swagger.json', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).send(swaggerDocument);
});

/**
 * Raw OpenAPI YAML specification
 */
router.get('/openapi.yaml', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/yaml');
  if (fs.existsSync(openApiPath)) {
    res.status(200).send(fs.readFileSync(openApiPath, 'utf-8'));
  } else {
    res.status(200).send(YAML.stringify(swaggerDocument));
  }
});

/**
 * Swagger UI interactive interface
 */
router.use('/', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

export default router;
