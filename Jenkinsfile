// Declarative pipeline for AI-QA-AGENT-FRAMEWORK.
// Requires the Docker Pipeline, HTML Publisher and JUnit plugins.
// Credentials (Jenkins > Credentials, "Secret text"): openai-api-key, anthropic-api-key, google-api-key
pipeline {
  agent {
    docker {
      // Official Playwright image: Node + browsers + OS dependencies. Keep in sync with @playwright/test.
      image 'mcr.microsoft.com/playwright:v1.65.0-noble'
      args '--ipc=host'
    }
  }

  parameters {
    choice(name: 'LLM_PROVIDER', choices: ['mock', 'openai', 'anthropic', 'google', 'azure-openai', 'ollama'], description: 'Model provider for the AI agents')
    string(name: 'LLM_MODEL', defaultValue: '', description: 'Optional model id (blank = provider default)')
    string(name: 'REQUIREMENT', defaultValue: 'requirements/REQ-001-product-search.md', description: 'Requirement for the AI pipeline')
    booleanParam(name: 'RUN_AI_PIPELINE', defaultValue: false, description: 'Run the autonomous multi-agent pipeline')
    booleanParam(name: 'EXECUTE_GENERATED', defaultValue: true, description: 'Execute approved generated tests')
  }

  triggers { cron('H 2 * * 1-5') }

  options {
    timeout(time: 45, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '30'))
    timestamps()
  }

  environment {
    CI = 'true'
    HOME = "${WORKSPACE}"
    APP_BASE_URL = 'https://demowebshop.tricentis.com'
    LLM_PROVIDER = "${params.LLM_PROVIDER}"
    LLM_MODEL = "${params.LLM_MODEL}"
  }

  stages {
    stage('Install') {
      steps { sh 'npm ci' }
    }

    stage('Typecheck + agent unit tests') {
      steps {
        sh 'npm run typecheck'
        sh 'LLM_PROVIDER=mock npm run test:framework'
      }
    }

    stage('Smoke: UI + API') {
      steps { sh 'npm run test:smoke' }
    }

    stage('Autonomous AI pipeline') {
      when { anyOf { expression { params.RUN_AI_PIPELINE }; triggeredBy 'TimerTrigger' } }
      steps {
        withCredentials([
          string(credentialsId: 'openai-api-key', variable: 'OPENAI_API_KEY'),
          string(credentialsId: 'anthropic-api-key', variable: 'ANTHROPIC_API_KEY'),
          string(credentialsId: 'google-api-key', variable: 'GOOGLE_API_KEY')
        ]) {
          sh """
            npx tsx src/cli.ts full --file '${params.REQUIREMENT}' ${params.EXECUTE_GENERATED ? '--execute' : ''}
          """
        }
      }
    }
  }

  post {
    always {
      junit allowEmptyResults: true, testResults: 'reports/junit.xml'
      publishHTML(target: [reportDir: 'reports/playwright-html', reportFiles: 'index.html', reportName: 'Playwright Report', allowMissing: true, keepAll: true, alwaysLinkToLastBuild: true])
      archiveArtifacts allowEmptyArchive: true, artifacts: 'reports/**, generated-tests/**, logs/**, test-results/**'
    }
  }
}
