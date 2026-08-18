pipeline {
    agent any

    environment {
        containerName = 'ax-ip-sales-dashboard'
        githubUrl     = 'https://github.com/vibe-flo/ax-ip-sales-dashboard'
        appPort       = '8200'
        deployHost    = '10.1.22.179'
    }

    stages {
        stage('Checkout') {
            steps {
                git branch: 'main',
                    credentialsId: 'jenkins-test',
                    url: "${githubUrl}.git"
            }
        }
        stage('Build') {
            steps {
                sh "docker build -t ${containerName}:${env.BUILD_NUMBER} ."
            }
        }
        stage('Deploy') {
            steps {
                sh "docker rm -f ${containerName} || true"
                sh """
                    docker run -d --name ${containerName} \\
                        --restart unless-stopped \\
                        -p ${appPort}:80 \\
                        ${containerName}:${env.BUILD_NUMBER}
                """
            }
        }
        stage('Health Check') {
            steps {
                sh """
                    for i in \$(seq 1 20); do
                        curl -fsS http://${deployHost}:${appPort}/ >/dev/null && exit 0
                        sleep 2
                    done
                    docker logs --tail 30 ${containerName}
                    exit 1
                """
            }
        }
    }

    post {
        always {
            sh "docker image prune -f || true"
        }
    }
}
