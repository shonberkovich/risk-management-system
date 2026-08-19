import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import RetentionCalculator from "../components/RetentionCalculator";

export default function Retention() {
  return (
    <Stack spacing={3}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        אופטימיזציית השתתפות עצמית
      </Typography>
      <RetentionCalculator />
    </Stack>
  );
}
