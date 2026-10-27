import type { CategoryBatch } from "./types";

import { ecommerceBatch } from "./specs/ecommerce";
import { blogMediaBatch } from "./specs/blog-media";
import { corporateBatch } from "./specs/corporate";
import { localBusinessBatch } from "./specs/local-business";
import { entertainmentBatch } from "./specs/entertainment";
import { musicBatch } from "./specs/music";
import { saasBatch } from "./specs/saas";
import { healthFitnessBatch } from "./specs/health-fitness";
import { educationBatch } from "./specs/education";
import { realEstateBatch } from "./specs/real-estate";

export const BATCHES: CategoryBatch[] = [
  ecommerceBatch,
  blogMediaBatch,
  corporateBatch,
  localBusinessBatch,
  entertainmentBatch,
  musicBatch,
  saasBatch,
  healthFitnessBatch,
  educationBatch,
  realEstateBatch,
];
